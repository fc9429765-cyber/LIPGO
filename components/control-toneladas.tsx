"use client"

// Operación LIP › Control de Toneladas.
// Vista OPERATIVA para el coordinador: toneladas por día y acumuladas por
// trabajador, para gestionar personal (quién mueve menos, quién es más
// eficiente, qué vehículos atendió, en qué órdenes). Lee `getControlToneladas`
// (lib/control-toneladas-actions.ts), que reutiliza la MISMA fórmula que ya
// paga nómina — el número aquí nunca diverge del de Revisión de Nómina.
// El proyecto lo define el SELECTOR GLOBAL de la app (igual que Panel LIP
// Operación): el coordinador solo ve el suyo, no hay opción "Todo LIP" aquí.
//
// Visual (sistema LIPgo, 2026-10-02): resumen del periodo con cuatro cifras
// derivadas de la misma consulta (nada se recalcula aparte), filtros en una
// tarjeta compacta, tabla con estado por chip y esqueleto de carga.

import { Fragment, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow, Seccion } from "@/components/ui/lipgo"
import { ChevronRight, Loader2, Scale, Truck, Users } from "lucide-react"
import { getControlToneladas, type TrabajadorToneladas } from "@/lib/control-toneladas-actions"

const TODOS = "__todos__"
const BOGOTA_TZ = "America/Bogota"
const t2 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })
const t1 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })

// Fechas SIEMPRE en hora Colombia, sin pasar por el huso horario del
// navegador/servidor: `Date#toISOString()` convierte a UTC, así que después
// de las 7pm hora Colombia (UTC-5) ya cae en "mañana" en UTC y el filtro
// "Hoy" cogía el día siguiente. `hoyBogota()` lee la fecha real de Bogotá con
// Intl, y toda la aritmética de calendario se hace con Date.UTC (un
// calculador neutral, nunca se reconvierte a hora local).
function hoyBogota() {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOGOTA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m: m - 1, d } // m: mes 0-indexado, como Date
}
const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
const hoyISO = () => {
  const { y, m, d } = hoyBogota()
  return isoUTC(y, m, d)
}
const fechaCorta = (isoStr: string) => {
  const [a, m, d] = isoStr.split("-")
  return `${d}/${m}/${a}`
}

type Preset = "hoy" | "mes" | "mesAnterior" | "trimestre" | "anio"
const PRESETS: { key: Preset; label: string }[] = [
  { key: "hoy", label: "Hoy" },
  { key: "mes", label: "Este mes" },
  { key: "mesAnterior", label: "Mes anterior" },
  { key: "trimestre", label: "Últimos 3 meses" },
  { key: "anio", label: "Historial del año" },
]

export default function ControlToneladas() {
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()

  const [desde, setDesde] = useState(() => {
    const { y, m } = hoyBogota()
    return isoUTC(y, m, 1)
  })
  const [hasta, setHasta] = useState(() => {
    const { y, m } = hoyBogota()
    return isoUTC(y, m + 1, 0)
  })
  const [preset, setPreset] = useState<Preset | null>("mes")
  const [trabajadorFiltro, setTrabajadorFiltro] = useState(TODOS)
  const [loading, setLoading] = useState(false)
  const [cargado, setCargado] = useState(false)
  const [trabajadores, setTrabajadores] = useState<TrabajadorToneladas[]>([])
  const [expand, setExpand] = useState<Set<string>>(new Set())

  const consultar = async () => {
    if (!selectedEmpresaId) return
    setLoading(true)
    const r = await getControlToneladas(selectedEmpresaId, desde, hasta)
    setLoading(false)
    setCargado(true)
    if (r.success && r.data) {
      setTrabajadores(r.data.trabajadores)
      setExpand(new Set())
      setTrabajadorFiltro(TODOS)
    } else {
      setTrabajadores([])
      toast({ title: "No se pudo cargar Control de Toneladas", description: r.message, variant: "destructive" })
    }
  }

  // El proyecto lo define el SELECTOR GLOBAL (conector) de la app: se recarga
  // solo con lo del proyecto activo cuando el usuario lo cambia arriba.
  useEffect(() => {
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const aplicarPreset = (p: Preset) => {
    const { y, m } = hoyBogota()
    setPreset(p)
    if (p === "hoy") {
      setDesde(hoyISO())
      setHasta(hoyISO())
    } else if (p === "mes") {
      setDesde(isoUTC(y, m, 1))
      setHasta(isoUTC(y, m + 1, 0))
    } else if (p === "mesAnterior") {
      setDesde(isoUTC(y, m - 1, 1))
      setHasta(isoUTC(y, m, 0))
    } else if (p === "trimestre") {
      setDesde(isoUTC(y, m - 2, 1))
      setHasta(hoyISO())
    } else {
      setDesde(`${y}-01-01`)
      setHasta(hoyISO())
    }
  }

  const toggleExpand = (persona: string) => {
    setExpand((prev) => {
      const next = new Set(prev)
      if (next.has(persona)) next.delete(persona)
      else next.add(persona)
      return next
    })
  }

  const seleccionarTrabajador = (persona: string) => {
    setTrabajadorFiltro(persona)
    // Elegir un trabajador puntual abre directo su historial de órdenes/días.
    setExpand(persona === TODOS ? new Set() : new Set([persona]))
  }

  const nombresTrabajadores = useMemo(
    () => trabajadores.map((t) => t.persona).sort((a, b) => a.localeCompare(b)),
    [trabajadores],
  )
  const trabajadoresFiltrados =
    trabajadorFiltro === TODOS ? trabajadores : trabajadores.filter((t) => t.persona === trabajadorFiltro)
  const variosDias = desde !== hasta

  // Resumen del periodo, derivado de la MISMA respuesta (no es otra consulta).
  const resumen = useMemo(() => {
    const conTon = trabajadores.filter((t) => t.tonAcumulada > 0)
    const total = trabajadores.reduce((s, t) => s + (Number(t.tonAcumulada) || 0), 0)
    const conMeta = trabajadores.filter((t) => t.metaDia > 0)
    const cumplen = conMeta.filter((t) => t.pctCumplimiento >= 100).length
    const promDia = conTon.length > 0 ? conTon.reduce((s, t) => s + (Number(t.tonPromedioDia) || 0), 0) / conTon.length : 0
    const vehiculos = new Set<string>()
    for (const t of trabajadores) for (const v of t.vehiculos) vehiculos.add(v)
    return { total, personas: conTon.length, promDia, cumplen, conMeta: conMeta.length, vehiculos: vehiculos.size }
  }, [trabajadores])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Operación LIP · {selectedEmpresaId ? selectedEmpresaNombre || `ID ${selectedEmpresaId}` : "sin proyecto"}</Eyebrow>
          <h1 className="flex items-center gap-2 text-xl font-bold leading-tight sm:text-2xl">
            <Scale className="h-5 w-5 text-acento sm:h-6 sm:w-6" />
            Control de Toneladas
          </h1>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground sm:text-sm">
            Toneladas por día y acumuladas por trabajador, con la misma fórmula que paga nómina: para gestionar personal, ver quién mueve menos y qué vehículos y órdenes atendió cada uno.
          </p>
        </div>
      </div>

      {!selectedEmpresaId ? (
        <EstadoVacio titulo="Selecciona un proyecto" texto="Usa el selector de ID de la parte superior para consultar el Control de Toneladas." />
      ) : (
        <>
          {/* Filtros */}
          <div className="lg-card flex flex-wrap items-end gap-3 px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-1">
              <Label className="lg-eyebrow">Desde</Label>
              <DatePickerField value={desde} onChange={(v) => { setDesde(v); setPreset(null) }} className="h-9 w-[150px] text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="lg-eyebrow">Hasta</Label>
              <DatePickerField value={hasta} onChange={(v) => { setHasta(v); setPreset(null) }} className="h-9 w-[150px] text-sm" />
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => aplicarPreset(p.key)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    preset === p.key ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              <Label className="lg-eyebrow">Trabajador</Label>
              <Select value={trabajadorFiltro} onValueChange={seleccionarTrabajador}>
                <SelectTrigger className="h-9 w-[230px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos los trabajadores</SelectItem>
                  {nombresTrabajadores.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={consultar} disabled={loading} className="min-w-[130px]">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
              Consultar
            </Button>
          </div>

          {/* Resumen del periodo */}
          {loading && !cargado ? (
            <div className="lg-card grid grid-cols-2 gap-6 p-5 sm:grid-cols-4" aria-busy>
              <Esqueleto lineas={3} />
              <Esqueleto lineas={3} />
              <Esqueleto lineas={3} />
              <Esqueleto lineas={3} />
            </div>
          ) : cargado ? (
            <section className="lg-card grid grid-cols-2 gap-y-5 p-5 sm:grid-cols-4 sm:gap-x-6">
              <Cifra label="Toneladas del periodo" valor={t1(resumen.total)} unidad="t" sub={`${fechaCorta(desde)} a ${fechaCorta(hasta)}`} />
              <Cifra label="Personas con tonelaje" valor={resumen.personas} sub={`${resumen.vehiculos} vehículo${resumen.vehiculos === 1 ? "" : "s"} atendido${resumen.vehiculos === 1 ? "" : "s"}`} />
              <Cifra label="Promedio por persona y día" valor={t1(resumen.promDia)} unidad="t / día" sub="sobre quienes movieron tonelaje" />
              <Cifra
                label="Cumplen la meta diaria"
                valor={resumen.conMeta > 0 ? `${resumen.cumplen}/${resumen.conMeta}` : "—"}
                tono={resumen.conMeta === 0 ? "neutro" : resumen.cumplen === resumen.conMeta ? "ok" : resumen.cumplen / resumen.conMeta >= 0.7 ? "atencion" : "critico"}
                progreso={resumen.conMeta > 0 ? (resumen.cumplen / resumen.conMeta) * 100 : undefined}
                sub={resumen.conMeta > 0 ? "meta dinámica del proyecto por día" : "sin meta configurada en el periodo"}
              />
            </section>
          ) : null}

          {cargado && (
            <Seccion
              eyebrow={`${fechaCorta(desde)} a ${fechaCorta(hasta)}${trabajadorFiltro !== TODOS ? ` · ${trabajadorFiltro}` : ""}`}
              titulo="Toneladas por trabajador"
              accion={<span className="text-xs text-muted-foreground">De menor a mayor tonelaje · toca una fila para ver su detalle</span>}
              sinPadding
            >
              {trabajadoresFiltrados.length === 0 ? (
                <EstadoVacio titulo="Sin movimiento de toneladas en el periodo" texto="Amplía el rango de fechas o usa Historial del año." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4 sm:pl-5">Trabajador</TableHead>
                        <TableHead className="text-right">Días</TableHead>
                        <TableHead className="text-right">Ton acumulada</TableHead>
                        <TableHead className="text-right">Ton/día prom.</TableHead>
                        <TableHead className="text-right">Meta día</TableHead>
                        <TableHead className="text-right">Cumplimiento</TableHead>
                        <TableHead className="text-right">Vehículos</TableHead>
                        <TableHead className="pr-4 text-right sm:pr-5">Órdenes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="lg-num">
                      {trabajadoresFiltrados.map((t) => {
                        const abierto = expand.has(t.persona)
                        const cumple = t.metaDia > 0 && t.pctCumplimiento >= 100
                        return (
                          <Fragment key={t.persona}>
                            <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggleExpand(t.persona)}>
                              <TableCell className="pl-4 sm:pl-5">
                                <span className="inline-flex items-center gap-1.5 font-medium">
                                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${abierto ? "rotate-90" : ""}`} />
                                  {t.persona}
                                  {!t.activo && <Chip tono="neutro" className="font-normal">Inactivo hoy</Chip>}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">{t.diasTrabajados}</TableCell>
                              <TableCell className="text-right font-semibold">{t2(t.tonAcumulada)}</TableCell>
                              <TableCell className="text-right">{t2(t.tonPromedioDia)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{t.metaDia > 0 ? t2(t.metaDia) : "—"}</TableCell>
                              <TableCell className="text-right">
                                {t.metaDia > 0 ? <Chip tono={cumple ? "ok" : t.pctCumplimiento >= 70 ? "atencion" : "critico"}>{t.pctCumplimiento} %</Chip> : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell className="text-right">{t.vehiculos.length}</TableCell>
                              <TableCell className="pr-4 text-right sm:pr-5">{t.ordenes.length}</TableCell>
                            </TableRow>
                            {abierto && (
                              <TableRow className="bg-muted/20 hover:bg-muted/20">
                                <TableCell colSpan={8} className="px-3 py-3 sm:px-5">
                                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                                    <div className="max-h-72 overflow-auto rounded-xl border border-border bg-background">
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead className="text-xs">Fecha</TableHead>
                                            <TableHead className="text-xs">Orden</TableHead>
                                            <TableHead className="text-xs">Operación</TableHead>
                                            <TableHead className="text-xs">Puesto programado</TableHead>
                                            <TableHead className="text-xs">Placa</TableHead>
                                            <TableHead className="text-right text-xs">Ton asignada</TableHead>
                                            <TableHead className="text-xs">Personal real asignado</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody className="lg-num">
                                          {t.ordenes.map((o, i) => (
                                            <TableRow key={i}>
                                              <TableCell className="whitespace-nowrap text-xs">{o.fecha.slice(5)}</TableCell>
                                              <TableCell className="text-xs">{o.orden}</TableCell>
                                              <TableCell className="text-xs">{o.tipooperacion}</TableCell>
                                              <TableCell className="text-xs text-muted-foreground">{o.puesto || "—"}</TableCell>
                                              <TableCell className="text-xs">
                                                {o.placa ? (
                                                  <span className="inline-flex items-center gap-1">
                                                    <Truck className="h-3 w-3 text-muted-foreground" />
                                                    {o.placa}
                                                  </span>
                                                ) : (
                                                  "—"
                                                )}
                                              </TableCell>
                                              <TableCell className="text-right text-xs font-medium">{t2(o.tonPersona)}</TableCell>
                                              <TableCell className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={o.personalReal.join(", ")}>
                                                {o.personalReal.length > 0 ? o.personalReal.join(", ") : "—"}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                    <div className="max-h-72 min-w-[220px] overflow-auto rounded-xl border border-border bg-background p-3">
                                      <Eyebrow className="mb-2">{variosDias ? "Toneladas y vehículos por día" : "Vehículos del día"}</Eyebrow>
                                      <div className="space-y-2">
                                        {t.tonPorDia.map((d) => (
                                          <div key={d.fecha} className="border-b border-border pb-1.5 last:border-b-0 last:pb-0">
                                            <div className="flex items-center justify-between text-xs">
                                              <span className="font-medium text-muted-foreground">{d.fecha.slice(5)}</span>
                                              <span className="lg-num font-semibold">{t2(d.toneladas)} t</span>
                                            </div>
                                            {d.vehiculos.length > 0 && (
                                              <div className="mt-1 flex flex-wrap gap-1">
                                                {d.vehiculos.map((v) => (
                                                  <Badge key={v} variant="outline" className="text-[10px]">
                                                    {v}
                                                  </Badge>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
                <strong>Cumplimiento</strong> compara el promedio real de toneladas/día contra la meta dinámica del proyecto (toneladas de Cargue/Distribución acordadas ÷ personal real y horas realmente programadas ese día; ver Centro de Coordinación para el avance en vivo del turno). "Inactivo hoy" marca a quien ya no está en Head Count (se retiró después del periodo consultado): su tonelaje real del periodo se sigue mostrando.
              </p>
            </Seccion>
          )}
        </>
      )}
    </div>
  )
}
