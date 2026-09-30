"use client"

// Operación LIP › Productividad de Auxiliares (informe de GERENCIA).
// Quién carga de verdad en cada ID según `cabeceraoc.auxiliares_real` (lo que
// asignó el coordinador al vehículo), por día y por mes: ranking, toneladas
// reales vs. pagadas (pago Global), detalle por persona y exportación a Excel.
// El proyecto lo define el SELECTOR GLOBAL; sin proyecto = todo LIP (1–4).

import { useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Trophy, Loader2, Download, Users, Scale, CalendarDays, Info, Truck } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import * as XLSX from "xlsx"
import { getProductividadAuxiliares, type ProductividadData, type AuxiliarProductividad } from "@/lib/productividad-auxiliares-actions"

const BOGOTA_TZ = "America/Bogota"
const t2 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })
const t1 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })
const PLANTAS: Record<number, string> = { 1: "Indupan", 2: "Avimol", 3: "Cedi Funza", 4: "Cedi Medellín" }
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

function hoyBogota() {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: BOGOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m: m - 1, d }
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
const mesCorto = (ym: string) => {
  const [a, m] = ym.split("-")
  return `${MESES[Number(m) - 1]} ${a}`
}
const nombreCorto = (n: string) => {
  const p = n.split(/\s+/)
  return p.length >= 3 ? `${p[0]} ${p[p.length - 2]}` : n
}

export default function ProductividadAuxiliares() {
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
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ProductividadData | null>(null)
  const [tab, setTab] = useState("ranking")
  const [personaSel, setPersonaSel] = useState<string>("")
  // Los "AUXILIAR PRUEBA…" son apoyos externos que se pagan aparte pero sí
  // cargan; la gerencia puede ocultarlos para ver solo su personal de planta.
  const [incluirApoyos, setIncluirApoyos] = useState(true)
  const esApoyo = (n: string) => /PRUEBA/i.test(n)

  const consultar = async () => {
    setLoading(true)
    const r = await getProductividadAuxiliares(selectedEmpresaId ?? null, desde, hasta)
    setLoading(false)
    if (r.success && r.data) {
      setData(r.data)
      setPersonaSel((prev) => (r.data!.auxiliares.some((a) => a.persona === prev) ? prev : r.data!.auxiliares[0]?.persona ?? ""))
    } else {
      setData(null)
      toast({ title: "No se pudo cargar la productividad", description: r.message, variant: "destructive" })
    }
  }

  useEffect(() => {
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const aplicarPreset = (preset: "hoy" | "mes" | "mesAnterior" | "trimestre" | "anio") => {
    const { y, m } = hoyBogota()
    if (preset === "hoy") {
      setDesde(hoyISO())
      setHasta(hoyISO())
    } else if (preset === "mes") {
      setDesde(isoUTC(y, m, 1))
      setHasta(isoUTC(y, m + 1, 0))
    } else if (preset === "mesAnterior") {
      setDesde(isoUTC(y, m - 1, 1))
      setHasta(isoUTC(y, m, 0))
    } else if (preset === "trimestre") {
      setDesde(isoUTC(y, m - 2, 1))
      setHasta(hoyISO())
    } else {
      setDesde(`${y}-01-01`)
      setHasta(hoyISO())
    }
  }

  const cargadores = useMemo(
    () => (data?.auxiliares ?? []).filter((a) => a.ordenes > 0 && (incluirApoyos || !esApoyo(a.persona))),
    [data, incluirApoyos],
  )
  const soloPagados = useMemo(() => (data?.auxiliares ?? []).filter((a) => a.ordenes === 0 && a.tonPagada > 0), [data])
  const top = useMemo(() => cargadores.slice(0, 15).map((a) => ({ nombre: nombreCorto(a.persona), completo: a.persona, ton: a.tonReal })), [cargadores])
  const persona = useMemo(() => (data?.auxiliares ?? []).find((a) => a.persona === personaSel) ?? null, [data, personaSel])
  const variosMeses = (data?.meses.length ?? 0) > 1
  const tituloPlanta = selectedEmpresaId ? selectedEmpresaNombre || PLANTAS[selectedEmpresaId] || `ID${selectedEmpresaId}` : "Todo LIP"

  const exportar = () => {
    if (!data) return
    const wb = XLSX.utils.book_new()
    const ranking = [
      ["#", "Auxiliar", "Planta", "Activo", "Días", "Órdenes", "T reales", "T/día", "T/orden", "% del total", "T pagadas", "Real − pagada", "Órdenes estimadas"],
      ...cargadores.map((a, i) => [i + 1, a.persona, a.planta ? PLANTAS[a.planta] ?? a.planta : "varias", a.activo ? "sí" : "no", a.dias, a.ordenes, a.tonReal, a.tonPorDia, a.tonPorOrden, a.pctDelTotal, a.tonPagada, a.diferenciaRealPagada, a.ordenesEstimadas]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ranking), "Ranking")
    const dias = [["Fecha", "Órdenes", "Auxiliares reales", "Toneladas", "T por auxiliar", "Órdenes estimadas"], ...data.dias.map((d) => [d.fecha, d.ordenes, d.auxiliares, d.toneladas, d.tonPorAuxiliar, d.ordenesEstimadas])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dias), "Por día")
    const matrizDia = [["Auxiliar", ...data.fechas, "Total"], ...cargadores.map((a) => [a.persona, ...data.fechas.map((f) => a.tonPorFecha[f] ?? 0), a.tonReal])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizDia), "Auxiliar x día")
    if (variosMeses) {
      const matrizMes = [["Auxiliar", ...data.meses.map(mesCorto), "Total"], ...cargadores.map((a) => [a.persona, ...data.meses.map((m) => a.tonPorMes[m] ?? 0), a.tonReal])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizMes), "Auxiliar x mes")
    }
    const detalle = [["Auxiliar", "Fecha", "Orden", "Operación", "Planta", "Placa", "Peso orden", "Auxiliares reales", "T real", "Estimada", "Equipo real"]]
    for (const a of cargadores) for (const o of a.ordenesDetalle) detalle.push([a.persona, o.fecha, o.orden, o.tipooperacion, PLANTAS[o.planta] ?? String(o.planta), o.placa ?? "", o.peso, o.nReal, o.tonReal, o.estimada ? "sí" : "", o.crew.join(", ")] as any)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), "Detalle órdenes")
    XLSX.writeFile(wb, `productividad-auxiliares-${tituloPlanta.replace(/\s+/g, "_")}-${desde}_${hasta}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Trophy className="h-6 w-6" /> Productividad de Auxiliares
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Quién carga de verdad en <b className="text-foreground">{tituloPlanta}</b>: toneladas de cada orden repartidas entre el
            personal que el coordinador asignó al vehículo (auxiliares reales), no entre la lista de pago. Sirve para ver quién
            mueve más, su promedio por día y cuánto difiere lo que cargó de lo que se le pagó en pago Global.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={!data || loading} className="gap-1.5">
          <Download className="h-4 w-4" /> Excel
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Desde</Label>
            <DatePickerField value={desde} onChange={setDesde} className="h-9 w-[150px] text-sm" />
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Hasta</Label>
            <DatePickerField value={hasta} onChange={setHasta} className="h-9 w-[150px] text-sm" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("hoy")}>Hoy</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("mes")}>Este mes</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("mesAnterior")}>Mes anterior</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("trimestre")}>Últimos 3 meses</Button>
            <Button variant="outline" size="sm" onClick={() => aplicarPreset("anio")}>Año</Button>
          </div>
          <Button onClick={consultar} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />} Consultar
          </Button>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={incluirApoyos} onCheckedChange={setIncluirApoyos} /> Incluir apoyos externos (“AUXILIAR PRUEBA”)
          </label>
        </CardContent>
      </Card>

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi icon={<Scale className="h-4 w-4" />} label="Toneladas movidas" valor={`${t2(data.totalToneladas)} t`} nota={`${data.totalOrdenes} órdenes cerradas`} />
            <Kpi icon={<Users className="h-4 w-4" />} label="Auxiliares que cargaron" valor={String(data.totalAuxiliares)} nota={`${fechaCorta(data.desde)} – ${fechaCorta(data.hasta)}`} />
            <Kpi icon={<CalendarDays className="h-4 w-4" />} label="Promedio por auxiliar y día" valor={`${t2(data.promedioTonAuxiliarDia)} t`} nota={`${data.dias.length} días con operación`} />
            <Kpi
              icon={<Truck className="h-4 w-4" />}
              label="Toneladas por orden"
              valor={`${t2(data.totalOrdenes ? data.totalToneladas / data.totalOrdenes : 0)} t`}
              nota="peso promedio de cada orden"
            />
            <Kpi
              icon={<Info className="h-4 w-4" />}
              label="Cobertura de dato real"
              valor={`${t1(data.coberturaReal)} %`}
              nota={data.coberturaReal < 100 ? `${data.totalOrdenes - data.ordenesConReal} órdenes sin equipo real: se estimó con la lista de pago` : "todas las órdenes tienen equipo real"}
              alerta={data.coberturaReal < 90}
            />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="ranking">Ranking</TabsTrigger>
              <TabsTrigger value="dia">Por día</TabsTrigger>
              <TabsTrigger value="mes">Por mes</TabsTrigger>
              <TabsTrigger value="detalle">Detalle por auxiliar</TabsTrigger>
            </TabsList>

            {/* ===== Ranking ===== */}
            <TabsContent value="ranking" className="mt-4 space-y-4">
              {top.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Quién más carga (toneladas reales, top {top.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div style={{ height: Math.max(220, top.length * 28) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={top} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => t1(Number(v))} fontSize={11} />
                          <YAxis type="category" dataKey="nombre" width={150} fontSize={11} />
                          <Tooltip formatter={(v: any) => [`${t2(Number(v))} t`, "Toneladas reales"]} labelFormatter={(_l, p: any) => p?.[0]?.payload?.completo ?? ""} />
                          <Bar dataKey="ton" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                            <LabelList dataKey="ton" position="right" formatter={(v: any) => t1(Number(v))} fontSize={11} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ranking completo</CardTitle>
                  <CardDescription>
                    T reales = suma de (peso de la orden ÷ auxiliares reales de esa orden). T pagadas = lo que le repartió nómina con la
                    lista de pago. La diferencia positiva significa que cargó más de lo que se le pagó; negativa, que se le pagó más de lo
                    que cargó.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Auxiliar</TableHead>
                        {!selectedEmpresaId && <TableHead>Planta</TableHead>}
                        <TableHead className="text-right">Días</TableHead>
                        <TableHead className="text-right">Órdenes</TableHead>
                        <TableHead className="text-right">T reales</TableHead>
                        <TableHead className="text-right">T/día</TableHead>
                        <TableHead className="text-right">T/orden</TableHead>
                        <TableHead className="text-right">% total</TableHead>
                        <TableHead className="text-right">T pagadas</TableHead>
                        <TableHead className="text-right">Real − pagada</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargadores.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">Sin órdenes cerradas con equipo en el periodo.</TableCell>
                        </TableRow>
                      ) : (
                        cargadores.map((a, i) => (
                          <TableRow
                            key={a.persona}
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => {
                              setPersonaSel(a.persona)
                              setTab("detalle")
                            }}
                          >
                            <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                            <TableCell>
                              <span className="font-medium">{a.persona}</span>
                              {!a.activo && <Badge variant="outline" className="ml-2 text-[10px]">retirado</Badge>}
                              {a.ordenesEstimadas > 0 && (
                                <Badge variant="outline" className="ml-2 text-[10px] text-amber-700" title="Órdenes sin equipo real: se estimó con la lista de pago">
                                  {a.ordenesEstimadas} est.
                                </Badge>
                              )}
                            </TableCell>
                            {!selectedEmpresaId && <TableCell className="text-xs">{a.planta ? PLANTAS[a.planta] ?? a.planta : "varias"}</TableCell>}
                            <TableCell className="text-right tabular-nums">{a.dias}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.ordenes}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{t2(a.tonReal)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.tonPorDia)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.tonPorOrden)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t1(a.pctDelTotal)} %</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.tonPagada)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${a.diferenciaRealPagada > 0.5 ? "text-emerald-700" : a.diferenciaRealPagada < -0.5 ? "text-red-700" : ""}`}>
                              {a.diferenciaRealPagada > 0 ? "+" : ""}
                              {t2(a.diferenciaRealPagada)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {soloPagados.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      En la lista de pago sin cargar ninguna orden en el periodo: {soloPagados.map((a) => `${a.persona} (${t2(a.tonPagada)} t pagadas)`).join(" · ")}.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Por día ===== */}
            <TabsContent value="dia" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Toneladas por día</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.dias.map((d) => ({ ...d, dia: d.fecha.slice(8) + "/" + d.fecha.slice(5, 7) }))} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="dia" fontSize={11} />
                        <YAxis fontSize={11} tickFormatter={(v) => t1(Number(v))} />
                        <Tooltip formatter={(v: any, name: any) => [name === "toneladas" ? `${t2(Number(v))} t` : v, name === "toneladas" ? "Toneladas" : name]} />
                        <Bar dataKey="toneladas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="overflow-x-auto pt-5">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Órdenes</TableHead>
                        <TableHead className="text-right">Auxiliares reales</TableHead>
                        <TableHead className="text-right">Toneladas</TableHead>
                        <TableHead className="text-right">T por auxiliar</TableHead>
                        <TableHead className="text-right">Estimadas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.dias.map((d) => (
                        <TableRow key={d.fecha}>
                          <TableCell>{fechaCorta(d.fecha)}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.ordenes}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.auxiliares}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{t2(d.toneladas)}</TableCell>
                          <TableCell className="text-right tabular-nums">{t2(d.tonPorAuxiliar)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{d.ordenesEstimadas || ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Auxiliar × día (toneladas reales)</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background">Auxiliar</TableHead>
                        {data.fechas.map((f) => (
                          <TableHead key={f} className="text-right text-[11px]">{f.slice(8)}/{f.slice(5, 7)}</TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargadores.map((a) => (
                        <TableRow key={a.persona}>
                          <TableCell className="sticky left-0 bg-background text-xs font-medium whitespace-nowrap">{a.persona}</TableCell>
                          {data.fechas.map((f) => (
                            <TableCell key={f} className="text-right text-[11px] tabular-nums">{a.tonPorFecha[f] ? t1(a.tonPorFecha[f]) : ""}</TableCell>
                          ))}
                          <TableCell className="text-right text-xs font-semibold tabular-nums">{t2(a.tonReal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Por mes ===== */}
            <TabsContent value="mes" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Auxiliar × mes (toneladas reales)</CardTitle>
                  {!variosMeses && <CardDescription>El rango elegido cubre un solo mes. Usa “Últimos 3 meses” o “Año” para comparar meses.</CardDescription>}
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Auxiliar</TableHead>
                        {data.meses.map((m) => (
                          <TableHead key={m} className="text-right">{mesCorto(m)}</TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">T/día</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargadores.map((a) => (
                        <TableRow key={a.persona}>
                          <TableCell className="text-xs font-medium whitespace-nowrap">{a.persona}</TableCell>
                          {data.meses.map((m) => (
                            <TableCell key={m} className="text-right tabular-nums">{a.tonPorMes[m] ? t2(a.tonPorMes[m]) : ""}</TableCell>
                          ))}
                          <TableCell className="text-right font-semibold tabular-nums">{t2(a.tonReal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{t2(a.tonPorDia)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Detalle ===== */}
            <TabsContent value="detalle" className="mt-4 space-y-4">
              <Card>
                <CardContent className="flex flex-wrap items-end gap-3 pt-5">
                  <div className="min-w-[280px]">
                    <Label className="text-xs uppercase text-muted-foreground">Auxiliar</Label>
                    <Select value={personaSel} onValueChange={setPersonaSel}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Elige un auxiliar…" />
                      </SelectTrigger>
                      <SelectContent>
                        {cargadores.map((a) => (
                          <SelectItem key={a.persona} value={a.persona}>{a.persona}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {persona && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{persona.dias} días</Badge>
                      <Badge variant="secondary">{persona.ordenes} órdenes</Badge>
                      <Badge variant="secondary">{t2(persona.tonReal)} t reales</Badge>
                      <Badge variant="secondary">{t2(persona.tonPorDia)} t/día</Badge>
                      <Badge variant="secondary">cargue {t2(persona.tonRealCargue)} t · descargue {t2(persona.tonRealDescargue)} t</Badge>
                      <Badge variant="secondary">{t2(persona.tonPagada)} t pagadas</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
              {persona && (
                <Card>
                  <CardContent className="overflow-x-auto pt-5">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Orden</TableHead>
                          <TableHead>Operación</TableHead>
                          {!selectedEmpresaId && <TableHead>Planta</TableHead>}
                          <TableHead>Placa</TableHead>
                          <TableHead className="text-right">Peso orden</TableHead>
                          <TableHead className="text-right">Aux. reales</TableHead>
                          <TableHead className="text-right">T real</TableHead>
                          <TableHead>Equipo real</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {persona.ordenesDetalle.map((o) => (
                          <TableRow key={`${o.orden}-${o.fecha}`}>
                            <TableCell className="text-xs">{fechaCorta(o.fecha)}</TableCell>
                            <TableCell className="font-mono text-xs">{o.orden}</TableCell>
                            <TableCell className="text-xs">{o.tipooperacion}</TableCell>
                            {!selectedEmpresaId && <TableCell className="text-xs">{PLANTAS[o.planta] ?? o.planta}</TableCell>}
                            <TableCell className="text-xs">{o.placa ?? ""}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{t2(o.peso)}</TableCell>
                            <TableCell className="text-right text-xs tabular-nums">{o.nReal}{o.estimada ? " *" : ""}</TableCell>
                            <TableCell className="text-right text-xs font-semibold tabular-nums">{t2(o.tonReal)}</TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">{o.crew.map(nombreCorto).join(", ")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {persona.ordenesEstimadas > 0 && <p className="mt-2 text-[11px] text-muted-foreground">* Orden sin equipo real registrado: se usó la lista de pago.</p>}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

function Kpi({ icon, label, valor, nota, alerta }: { icon: React.ReactNode; label: string; valor: string; nota?: string; alerta?: boolean }) {
  return (
    <Card className={alerta ? "border-amber-300" : ""}>
      <CardContent className="pt-5">
        <p className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">{icon} {label}</p>
        <p className="text-2xl font-bold">{valor}</p>
        {nota && <p className="text-[11px] text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  )
}
