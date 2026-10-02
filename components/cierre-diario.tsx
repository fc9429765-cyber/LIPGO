"use client"

// CIERRE DE FACTURACIÓN DEL DÍA (dentro del Cuadro de Control de Facturación).
//
// Dos piezas del MISMO estado, para que no puedan contradecirse:
//   · <CierreDiarioTira/>  — siempre visible arriba del módulo.
//   · <CierreDiarioPanel/> — el desglose, en su pestaña.
//
// Es cross-proyecto: no depende del selector del módulo. Ver el porqué y el
// cálculo en lib/cierre-diario-actions.ts.
//
// OJO: no confundir con components/lip/cierre-dia-dashboard.tsx, que es el
// cierre de pedidos/despachos/RRHH dentro de Bitácora. Este es de facturación.

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { KpiCard } from "@/components/orders/dashboard-pedidos/kpi-card"
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  CreditCard,
  Loader2,
  RefreshCw,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react"
import { getCierreDiario, type CierreDiario, type BloqueAlerta } from "@/lib/cierre-diario-actions"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")
const moneyS = (n: number) =>
  (n < 0 ? "−" : "") + "$" + Math.abs(Math.round(Number(n) || 0)).toLocaleString("es-CO")

/** Hoy en Bogotá — mismo criterio que el server action. */
function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

const REFRESH_MS = 60_000

/**
 * Estado compartido. La tira y el panel lo montan por separado, así que cada
 * uno pide su propia data; el server action es barato (~1 s) y así la tira
 * sigue viva aunque el usuario nunca abra la pestaña.
 */
function useCierreDiario(fecha: string, empresaId?: number | null) {
  const [data, setData] = useState<CierreDiario | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const montado = useRef(true)

  const cargar = useCallback(
    async (silencioso: boolean) => {
      // Refresco SILENCIOSO: en los ciclos automáticos se conserva la data
      // previa para que la pantalla no parpadee cada minuto.
      if (!silencioso) setLoading(true)
      const r = await getCierreDiario(fecha, empresaId ?? null)
      if (!montado.current) return
      if (r.success && r.data) {
        setData(r.data)
        setError(null)
      } else if (!silencioso) {
        setData(null)
        setError(r.message || "No se pudo armar el cierre del día.")
      }
      setLoading(false)
    },
    [fecha, empresaId],
  )

  useEffect(() => {
    montado.current = true
    cargar(false)
    // Un día pasado ya no cambia: solo se repolea el de hoy.
    const esHoy = fecha === hoyISO()
    const t = esHoy ? setInterval(() => cargar(true), REFRESH_MS) : null
    return () => {
      montado.current = false
      if (t) clearInterval(t)
    }
  }, [cargar, fecha])

  return { data, loading, error, refrescar: () => cargar(false) }
}

const totalAlertas = (d: CierreDiario | null) =>
  d ? d.alertas.tercero_sin_respaldo.ordenes + d.alertas.sin_medio_pago.ordenes + d.alertas.pago_no_cuadra.ordenes : 0

// ---------------------------------------------------------------------------
// TIRA — siempre visible arriba del módulo
// ---------------------------------------------------------------------------

export function CierreDiarioTira({
  onVerDetalle,
  empresaId,
}: {
  onVerDetalle?: () => void
  /** Con proyecto, la tira muestra SOLO ese proyecto (el del selector del
   *  módulo). Sin proyecto, suma todos los accesibles como antes. */
  empresaId?: number | null
}) {
  const { data, loading } = useCierreDiario(hoyISO(), empresaId)
  const alertas = totalAlertas(data)

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando el cierre del día…
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  const Dato = ({ l, v, tone }: { l: string; v: string; tone?: string }) => (
    <div className="min-w-0">
      <div className="lg-eyebrow">{l}</div>
      <div className={`truncate text-sm font-bold tabular-nums ${tone ?? ""}`}>{v}</div>
    </div>
  )

  return (
    <Card className={alertas > 0 ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/10" : ""}>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          Hoy {data.fecha}
          <span className="font-normal text-muted-foreground">· {data.totales.ordenes} órdenes</span>
        </div>
        <Dato l="Cobro" v={money(data.totales.cobro)} />
        <Dato l="Contado" v={money(data.totales.contado)} tone="text-emerald-700 dark:text-emerald-400" />
        <Dato l="Crédito" v={money(data.totales.credito)} tone="text-indigo-700 dark:text-indigo-400" />
        {data.totales.sinDefinir > 0 && (
          <Dato l="Sin definir" v={money(data.totales.sinDefinir)} tone="text-amber-700 dark:text-amber-400" />
        )}
        <Dato l="Costo nómina" v={money(data.totales.costo)} />
        <Dato
          l="Margen"
          v={moneyS(data.totales.margen)}
          tone={data.totales.margen >= 0 ? "text-emerald-600" : "text-rose-600"}
        />
        {/* Siempre navegable: es la única entrada garantizada a la pestaña
            cuando el proyecto seleccionado no tiene órdenes y el resto del
            módulo se colapsa en un estado vacío. */}
        <Button
          size="sm"
          variant="outline"
          className={`ml-auto h-8 ${alertas > 0 ? "border-red-300 text-red-700 hover:bg-red-50 dark:text-red-400" : ""}`}
          onClick={onVerDetalle}
        >
          {alertas > 0 ? (
            <>
              <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
              {alertas} por revisar
            </>
          ) : (
            "Ver cierre"
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PANEL — el contenido de la pestaña
// ---------------------------------------------------------------------------

function TablaAlerta({ titulo, bloque, explicacion }: { titulo: string; bloque: BloqueAlerta; explicacion: string }) {
  if (bloque.ordenes === 0) return null
  return (
    <Card className="border-amber-300">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {titulo} ({bloque.ordenes}) · {money(bloque.valor)}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{explicacion}</p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Orden</TableHead>
              <TableHead>Proyecto</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Transporte</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Qué le falta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bloque.detalle.slice(0, 60).map((o) => (
              <TableRow key={`${o.numeroorden}-${o.idempresa}`}>
                <TableCell className="text-xs font-medium">{o.numeroorden}</TableCell>
                <TableCell className="text-xs">{o.proyecto}</TableCell>
                <TableCell className="text-xs">{o.placa ?? "—"}</TableCell>
                <TableCell className="text-xs">{o.transporte ?? "—"}</TableCell>
                <TableCell className="text-right text-xs font-semibold tabular-nums">{money(o.valor)}</TableCell>
                <TableCell className="text-xs text-amber-700 dark:text-amber-400">{o.motivo}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {bloque.detalle.length > 60 && (
          <p className="p-3 text-xs text-muted-foreground">
            Mostrando las 60 de mayor valor de {bloque.detalle.length}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function CierreDiarioPanel({ empresaId }: { empresaId?: number | null } = {}) {
  const [fecha, setFecha] = useState(hoyISO())
  const { data, loading, error, refrescar } = useCierreDiario(fecha, empresaId)

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">Día</Label>
            <DatePickerField
              value={fecha}
              maxDate={hoyISO()}
              onChange={(value) => setFecha(value || hoyISO())}
              className="h-8 w-[160px] text-xs"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8" onClick={refrescar} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Refrescar
          </Button>
          <p className="text-xs text-muted-foreground">
            {empresaId ? (
              <>
                Muestra <strong>el proyecto elegido en el selector del módulo</strong>.
              </>
            ) : (
              <>
                Suma <strong>todos los proyectos</strong> a los que tienes acceso.
              </>
            )}
            {fecha === hoyISO() && " Se actualiza solo cada minuto."}
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-300">
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {loading && !data && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Armando el cierre…
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* El día 31 no paga base salarial, así que su margen se ve inflado
              si nadie lo advierte. */}
          {data.esDia31 && (
            <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/20">
              <CardContent className="flex items-start gap-2 p-3 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong>Es día 31.</strong> Ese día no paga base salarial —solo novedades y lo producido a
                  destajo—, así que el costo sale mucho más bajo de lo normal y el margen queda inflado. No lo
                  compares contra un día corriente.
                </span>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Cobro del día"
              value={money(data.totales.cobro)}
              subtext={`${data.totales.ordenes} órdenes procesadas`}
              icon={Wallet}
              variant="primary"
            />
            <KpiCard
              label="Contado"
              value={money(data.totales.contado)}
              subtext="pago inmediato"
              icon={Banknote}
              variant="success"
            />
            <KpiCard
              label="Crédito"
              value={money(data.totales.credito)}
              subtext={
                data.totales.sinDefinir > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    + {money(data.totales.sinDefinir)} sin condición definida
                  </span>
                ) : (
                  "cartera del día"
                )
              }
              icon={CreditCard}
              variant={data.totales.sinDefinir > 0 ? "warning" : "primary"}
            />
            <KpiCard
              label="Margen del día"
              value={moneyS(data.totales.margen)}
              subtext={`cobro ${money(data.totales.cobro)} − nómina ${money(data.totales.costo)}`}
              icon={TrendingUp}
              variant={data.totales.margen >= 0 ? "success" : "danger"}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Por proyecto</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proyecto</TableHead>
                    <TableHead className="text-right">Órdenes</TableHead>
                    <TableHead className="text-right">Cobro</TableHead>
                    <TableHead className="text-right">Contado</TableHead>
                    <TableHead className="text-right">Crédito</TableHead>
                    <TableHead className="text-right">Sin definir</TableHead>
                    <TableHead className="text-right">Costo nómina</TableHead>
                    <TableHead className="text-right">Margen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porProyecto.map((p) => (
                    <TableRow key={p.idempresa}>
                      <TableCell className="font-medium">{p.proyecto}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.ordenes}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(p.cobro)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{money(p.contado)}</TableCell>
                      <TableCell className="text-right tabular-nums text-indigo-700">{money(p.credito)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${p.sinDefinir > 0 ? "font-semibold text-amber-700" : "text-muted-foreground"}`}
                      >
                        {money(p.sinDefinir)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{money(p.costo)}</TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${p.margen >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                      >
                        {moneyS(p.margen)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t bg-muted/40">
                    <TableCell className="font-bold">TOTAL</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{data.totales.ordenes}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{money(data.totales.cobro)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-emerald-700">{money(data.totales.contado)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-indigo-700">{money(data.totales.credito)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums text-amber-700">{money(data.totales.sinDefinir)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{money(data.totales.costo)}</TableCell>
                    <TableCell
                      className={`text-right font-bold tabular-nums ${data.totales.margen >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {moneyS(data.totales.margen)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Por tipo de transporte</CardTitle>
              <p className="text-xs text-muted-foreground">
                La columna <strong>Le corresponde</strong> sale de la regla del proyecto (en Avimol, TERCEROS de
                contado y ZAMUDIO a crédito). En rojo, las órdenes que la contradicen.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Transporte</TableHead>
                    <TableHead>Le corresponde</TableHead>
                    <TableHead className="text-right">Órdenes</TableHead>
                    <TableHead className="text-right">Cobro</TableHead>
                    <TableHead className="text-right">Contado</TableHead>
                    <TableHead className="text-right">Crédito</TableHead>
                    <TableHead className="text-right">Sin definir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.porTransporte.map((t) => (
                    <TableRow key={`${t.idempresa}-${t.transporte}`}>
                      <TableCell className="text-xs">{t.proyecto}</TableCell>
                      <TableCell className="text-xs font-medium">{t.transporte}</TableCell>
                      <TableCell className="text-xs">
                        {t.esperado ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                t.esperado === "Contado"
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                              }`}
                            >
                              {t.esperado}
                            </span>
                            {t.inconsistentes > 0 && (
                              <span className="text-[10px] font-semibold text-red-600">⚠ {t.inconsistentes}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">sin regla</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.ordenes}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(t.cobro)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{money(t.contado)}</TableCell>
                      <TableCell className="text-right tabular-nums text-indigo-700">{money(t.credito)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${t.sinDefinir > 0 ? "font-semibold text-amber-700" : "text-muted-foreground"}`}
                      >
                        {money(t.sinDefinir)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.porTransporte.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-20 text-center text-sm text-muted-foreground">
                        Sin órdenes procesadas este día.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <TablaAlerta
            titulo="Terceros sin respaldo"
            bloque={data.alertas.tercero_sin_respaldo}
            explicacion="El tercero paga de contado, así que el vehículo no debería salir sin soporte de pago. Estas órdenes ya se atendieron y les falta el soporte, la factura de Siigo, o ambos."
          />
          <TablaAlerta
            titulo="Sin medio de pago"
            bloque={data.alertas.sin_medio_pago}
            explicacion="Órdenes procesadas que aún no tienen registrado si son de contado o a crédito. Hasta que se defina, no se sabe si hay que cobrar hoy o queda en cartera."
          />
          <TablaAlerta
            titulo="El pago no cuadra con el transporte"
            bloque={data.alertas.pago_no_cuadra}
            explicacion="El medio de pago registrado contradice la regla del transporte del proyecto."
          />

          {totalAlertas(data) === 0 && data.totales.ordenes > 0 && (
            <Card className="border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20">
              <CardContent className="flex items-center gap-2 p-4 text-sm text-emerald-800 dark:text-emerald-300">
                <Users className="h-4 w-4" /> El día está limpio: todas las órdenes tienen su condición de pago y
                ningún tercero quedó sin respaldo.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
