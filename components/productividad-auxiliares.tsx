"use client"

// Operación LIP › Productividad de Auxiliares (informe de GERENCIA).
// Dos modos:
//   · EQUIPO: quién carga y descarga de verdad en el ID según
//     `cabeceraoc.auxiliares_real` (lo que asignó el coordinador al vehículo):
//     tarjetas por tipo, podios de cargue y descargue, ranking, por día, por
//     mes, vehículos y Tolva (producción, aparte).
//   · FICHA 360° del auxiliar (clic en cualquier nombre): dónde estuvo cada día
//     (programación/asistencia + vehículos), cómo se compara con el promedio del
//     equipo, con quién trabaja, qué vehículos atiende, real vs pagado y órdenes.
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
import { Trophy, Loader2, Download, Users, Scale, CalendarDays, Truck, Medal, ArrowDownToLine, ArrowUpFromLine, Route, Factory, ArrowLeft, UserSearch, MapPin, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, Line } from "recharts"
import * as XLSX from "xlsx"
import { getProductividadAuxiliares } from "@/lib/productividad-auxiliares-actions"
import type { ProductividadData, AuxiliarProductividad, TipoOp } from "@/lib/productividad-auxiliares-tipos"

const BOGOTA_TZ = "America/Bogota"
const t2 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })
const t1 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })
const PLANTAS: Record<number, string> = { 1: "Indupan", 2: "Avimol", 3: "Cedi Funza", 4: "Cedi Medellín" }
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
const TIPO_LABEL: Record<TipoOp, string> = { cargue: "Cargue", descargue: "Descargue", distribucion: "Distribución", tolva: "Tolva (producción)", otro: "Otros" }
const TIPO_COLOR: Record<TipoOp, string> = { cargue: "hsl(var(--primary))", descargue: "#0e9f6e", distribucion: "#f59e0b", tolva: "#8b5cf6", otro: "#94a3b8" }
const TIPOS_VEHICULO: TipoOp[] = ["cargue", "descargue", "distribucion", "otro"]
const esApoyo = (n: string) => /PRUEBA/i.test(n)

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
const diaMes = (isoStr: string) => `${isoStr.slice(8)}/${isoStr.slice(5, 7)}`
const mesCorto = (ym: string) => {
  const [a, m] = ym.split("-")
  return `${MESES[Number(m) - 1]} ${a}`
}
const nombreCorto = (n: string) => {
  const p = n.split(/\s+/)
  return p.length >= 3 ? `${p[0]} ${p[p.length - 2]}` : n
}
const diaSemana = (isoStr: string) => ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][new Date(`${isoStr}T12:00:00Z`).getUTCDay()]

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
  /** null = modo Equipo; nombre = Ficha 360° de ese auxiliar. */
  const [personaSel, setPersonaSel] = useState<string | null>(null)
  // Los "AUXILIAR PRUEBA…" son apoyos externos que se pagan aparte pero sí
  // cargan; la gerencia puede ocultarlos para ver solo su personal de planta.
  const [incluirApoyos, setIncluirApoyos] = useState(true)

  const consultar = async () => {
    setLoading(true)
    const r = await getProductividadAuxiliares(selectedEmpresaId ?? null, desde, hasta)
    setLoading(false)
    if (r.success && r.data) {
      setData(r.data)
      setPersonaSel((prev) => (prev && r.data!.auxiliares.some((a) => a.persona === prev) ? prev : null))
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

  const visibles = useMemo(
    () => (data?.auxiliares ?? []).filter((a) => (a.vehiculos > 0 || a.operacionesTolva > 0) && (incluirApoyos || !esApoyo(a.persona))),
    [data, incluirApoyos],
  )
  const cargadores = useMemo(() => visibles.filter((a) => a.vehiculos > 0), [visibles])
  const tolveros = useMemo(() => [...visibles].filter((a) => a.tonTolva > 0).sort((a, b) => b.tonTolva - a.tonTolva), [visibles])
  const soloPagados = useMemo(() => (data?.auxiliares ?? []).filter((a) => a.vehiculos === 0 && a.operacionesTolva === 0 && a.tonPagada > 0), [data])
  const topDe = (k: TipoOp) => [...cargadores].filter((a) => a.tonPorTipo[k] > 0).sort((a, b) => b.tonPorTipo[k] - a.tonPorTipo[k]).slice(0, 8)
  const tiposVehiculo = useMemo(() => (data ? TIPOS_VEHICULO.filter((k) => data.tonPorTipo[k] > 0) : []), [data])
  const hayTolva = (data?.operacionesTolva ?? 0) > 0
  const persona = useMemo(() => (personaSel ? (data?.auxiliares ?? []).find((a) => a.persona === personaSel) ?? null : null), [data, personaSel])
  const variosMeses = (data?.meses.length ?? 0) > 1
  const tituloPlanta = selectedEmpresaId ? selectedEmpresaNombre || PLANTAS[selectedEmpresaId] || `ID${selectedEmpresaId}` : "Todo LIP"
  const lider = cargadores[0]
  const liderDe = (k: TipoOp) => (k === "tolva" ? tolveros[0] : topDe(k)[0])

  const exportar = () => {
    if (!data) return
    const wb = XLSX.utils.book_new()
    const ranking = [
      ["#", "Auxiliar", "Planta", "Activo", "Días", "Días prog. cargue/desc.", "Vehículos", "Veh. cargue", "Veh. descargue", "Veh. distribución", "Placas distintas", "T reales (vehículos)", "T cargue", "T descargue", "T distribución", "T/día", "T/vehículo", "% del total", "T pagadas", "Real − pagada", "Oper. tolva", "T tolva", "Órdenes estimadas"],
      ...visibles.map((a, i) => [i + 1, a.persona, a.planta ? PLANTAS[a.planta] ?? a.planta : "varias", a.activo ? "sí" : "no", a.dias, a.diasProgramadosCargue, a.vehiculos, a.vehiculosPorTipo.cargue, a.vehiculosPorTipo.descargue, a.vehiculosPorTipo.distribucion, a.placasDistintas, a.tonReal, a.tonPorTipo.cargue, a.tonPorTipo.descargue, a.tonPorTipo.distribucion, a.tonPorDia, a.tonPorVehiculo, a.pctDelTotal, a.tonPagada, a.diferenciaRealPagada, a.operacionesTolva, a.tonTolva, a.ordenesEstimadas]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ranking), "Ranking")
    const dias = [["Fecha", "Vehículos", "Cargue", "Descargue", "Distribución", "Auxiliares reales", "Toneladas vehículos", "T cargue", "T descargue", "T por auxiliar", "Oper. tolva", "T tolva", "Aux. tolva", "Órdenes estimadas"], ...data.dias.map((d) => [d.fecha, d.vehiculos, d.vehiculosPorTipo.cargue, d.vehiculosPorTipo.descargue, d.vehiculosPorTipo.distribucion, d.auxiliares, d.toneladas, d.tonPorTipo.cargue, d.tonPorTipo.descargue, d.tonPorAuxiliar, d.operacionesTolva, d.tonTolva, d.auxiliaresTolva, d.ordenesEstimadas])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dias), "Por día")
    const matrizDia = [["Auxiliar", ...data.fechas, "Total"], ...cargadores.map((a) => [a.persona, ...data.fechas.map((f) => a.tonPorFecha[f] ?? 0), a.tonReal])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizDia), "Auxiliar x día")
    if (variosMeses) {
      const matrizMes = [["Auxiliar", ...data.meses.map(mesCorto), "Total"], ...cargadores.map((a) => [a.persona, ...data.meses.map((m) => a.tonPorMes[m] ?? 0), a.tonReal])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrizMes), "Auxiliar x mes")
    }
    const veh = [["Placa", "Visitas", "Cargue", "Descargue", "Distribución", "Toneladas", "T por visita", "Primera visita", "Última visita", "Auxiliares frecuentes"], ...data.vehiculos.map((v) => [v.placa, v.visitas, v.visitasPorTipo.cargue, v.visitasPorTipo.descargue, v.visitasPorTipo.distribucion, v.toneladas, v.tonPorVisita, v.primeraVisita, v.ultimaVisita, v.auxiliaresFrecuentes.map((x) => `${x.persona} (${x.veces})`).join("; ")])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(veh), "Vehículos")
    if (hayTolva) {
      const tolva = [["#", "Auxiliar", "Operaciones tolva", "T tolva", "T por operación"], ...tolveros.map((a, i) => [i + 1, a.persona, a.operacionesTolva, a.tonTolva, a.operacionesTolva ? Math.round((a.tonTolva / a.operacionesTolva) * 1000) / 1000 : 0])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tolva), "Tolva")
    }
    const detalle = [["Auxiliar", "Fecha", "Orden", "Operación", "Tipo", "Planta", "Placa", "Peso orden", "Equipo real", "T real", "Estimada", "Equipo"]]
    for (const a of visibles) for (const o of a.ordenesDetalle) detalle.push([a.persona, o.fecha, o.orden, o.tipooperacion, TIPO_LABEL[o.tipo], PLANTAS[o.planta] ?? String(o.planta), o.placa ?? "", o.peso, o.nReal, o.tonReal, o.estimada ? "sí" : "", o.crew.join(", ")] as any)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detalle), "Detalle órdenes")
    const asist = [["Auxiliar", "Fecha", "Planta", "Puesto programado", "Novedad", "Entrada prog.", "Salida prog.", "Entrada real", "Salida real"]]
    for (const a of visibles) for (const s of a.asistencia) asist.push([a.persona, s.fecha, PLANTAS[s.planta] ?? String(s.planta), s.puesto ?? "", s.novedad ?? "", s.entradaProgramada ?? "", s.salidaProgramada ?? "", s.entradaReal ?? "", s.salidaReal ?? ""] as any)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(asist), "Programación")
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
            Quién carga y descarga de verdad en <b className="text-foreground">{tituloPlanta}</b>, según el equipo que el coordinador asignó a cada
            vehículo. Haz clic en cualquier auxiliar para ver su ficha 360°.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Select value={personaSel ?? "__equipo__"} onValueChange={(v) => setPersonaSel(v === "__equipo__" ? null : v)}>
              <SelectTrigger className="h-9 w-[260px]">
                <div className="flex items-center gap-1.5 truncate">
                  <UserSearch className="h-3.5 w-3.5 shrink-0" />
                  <SelectValue placeholder="Ver ficha 360° de…" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__equipo__">Todo el equipo</SelectItem>
                {visibles.map((a) => (
                  <SelectItem key={a.persona} value={a.persona}>{a.persona}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={exportar} disabled={!data || loading} className="gap-1.5">
            <Download className="h-4 w-4" /> Excel
          </Button>
        </div>
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

      {data && persona ? (
        <Ficha360
          persona={persona}
          data={data}
          cargadores={cargadores}
          mostrarPlanta={!selectedEmpresaId}
          onVolver={() => setPersonaSel(null)}
          onElegir={(p) => setPersonaSel(p)}
        />
      ) : data ? (
        <>
          {/* Resumen del periodo: el informe habla por sí solo. */}
          {(lider || hayTolva) && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed">
              <Trophy className="mr-1.5 inline h-4 w-4 text-amber-500" />
              En {tituloPlanta}, del {fechaCorta(data.desde)} al {fechaCorta(data.hasta)}, <b>{data.totalAuxiliares} auxiliares</b> atendieron{" "}
              <b>{data.totalOrdenes} vehículos</b> ({data.vehiculos.length} placas) con <b>{t2(data.totalToneladas)} t</b>, un promedio de{" "}
              {t2(data.promedioTonAuxiliarDia)} t por auxiliar y día.
              {lider && (
                <>
                  {" "}El que más movió fue{" "}
                  <button type="button" className="font-semibold text-primary underline-offset-2 hover:underline" onClick={() => setPersonaSel(lider.persona)}>
                    {lider.persona}
                  </button>
                  : {t2(lider.tonReal)} t en {lider.vehiculos} vehículos y {lider.dias} días ({t2(lider.tonPorDia)} t por día).
                </>
              )}
              {hayTolva && (
                <>
                  {" "}Aparte, en <b>producción (tolva)</b>: {data.operacionesTolva} operaciones por {t2(data.tonTolva)} t con {data.auxiliaresTolva} auxiliares.
                </>
              )}
              {data.coberturaReal < 100 && (
                <span className="text-amber-800"> · {data.totalOrdenes - data.ordenesConReal} vehículos sin equipo real registrado (estimados con la lista de pago; cobertura {t1(data.coberturaReal)} %).</span>
              )}
            </div>
          )}

          {/* Tarjetas por tipo de operación: las mismas cifras que los podios y el ranking. */}
          <div className={`grid gap-3 sm:grid-cols-2 ${hayTolva || tiposVehiculo.includes("distribucion") ? "xl:grid-cols-4" : "xl:grid-cols-2"}`}>
            <TarjetaTipo tipo="cargue" icono={<ArrowUpFromLine className="h-4 w-4" />} ton={data.tonPorTipo.cargue} ops={data.vehiculosPorTipo.cargue} aux={data.auxiliaresPorTipo.cargue} lider={liderDe("cargue")} unidad="vehículos" onElegir={setPersonaSel} />
            <TarjetaTipo tipo="descargue" icono={<ArrowDownToLine className="h-4 w-4" />} ton={data.tonPorTipo.descargue} ops={data.vehiculosPorTipo.descargue} aux={data.auxiliaresPorTipo.descargue} lider={liderDe("descargue")} unidad="vehículos" onElegir={setPersonaSel} />
            {tiposVehiculo.includes("distribucion") && (
              <TarjetaTipo tipo="distribucion" icono={<Route className="h-4 w-4" />} ton={data.tonPorTipo.distribucion} ops={data.vehiculosPorTipo.distribucion} aux={data.auxiliaresPorTipo.distribucion} lider={liderDe("distribucion")} unidad="vehículos" onElegir={setPersonaSel} />
            )}
            {hayTolva && (
              <TarjetaTipo tipo="tolva" icono={<Factory className="h-4 w-4" />} ton={data.tonTolva} ops={data.operacionesTolva} aux={data.auxiliaresTolva} lider={liderDe("tolva")} unidad="operaciones" nota="Producción, no cargue ni descargue: va aparte de los vehículos." onElegir={setPersonaSel} />
            )}
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="ranking">Ranking</TabsTrigger>
              <TabsTrigger value="dia">Por día</TabsTrigger>
              <TabsTrigger value="mes">Por mes</TabsTrigger>
              <TabsTrigger value="vehiculos">Vehículos</TabsTrigger>
              {hayTolva && <TabsTrigger value="tolva">Tolva (producción)</TabsTrigger>}
            </TabsList>

            {/* ===== Ranking ===== */}
            <TabsContent value="ranking" className="mt-4 space-y-4">
              <div className={`grid gap-4 ${topDe("distribucion").length ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
                <Podio titulo="Top cargue" icono={<ArrowUpFromLine className="h-4 w-4" />} tipo="cargue" lista={topDe("cargue")} onElegir={setPersonaSel} />
                <Podio titulo="Top descargue" icono={<ArrowDownToLine className="h-4 w-4" />} tipo="descargue" lista={topDe("descargue")} onElegir={setPersonaSel} />
                {topDe("distribucion").length > 0 && <Podio titulo="Top distribución" icono={<Route className="h-4 w-4" />} tipo="distribucion" lista={topDe("distribucion")} onElegir={setPersonaSel} />}
              </div>

              {cargadores.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Toneladas reales en vehículos por auxiliar y tipo (top {Math.min(15, cargadores.length)})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div style={{ height: Math.max(240, Math.min(15, cargadores.length) * 30) }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={cargadores.slice(0, 15).map((a) => ({ nombre: nombreCorto(a.persona), completo: a.persona, ...a.tonPorTipo }))} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => t1(Number(v))} fontSize={11} />
                          <YAxis type="category" dataKey="nombre" width={150} fontSize={11} />
                          <Tooltip formatter={(v: any, name: any) => [`${t2(Number(v))} t`, TIPO_LABEL[name as TipoOp] ?? name]} labelFormatter={(_l, p: any) => p?.[0]?.payload?.completo ?? ""} />
                          <Legend formatter={(v) => TIPO_LABEL[v as TipoOp] ?? v} />
                          {tiposVehiculo.map((k) => (
                            <Bar key={k} dataKey={k} stackId="t" fill={TIPO_COLOR[k]} radius={k === tiposVehiculo[tiposVehiculo.length - 1] ? [0, 4, 4, 0] : undefined} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Ranking completo (vehículos)</CardTitle>
                  <CardDescription>
                    T reales = peso de cada vehículo ÷ su equipo real. Real − pagada: en verde cargó más de lo que se le pagó; en rojo, se le pagó más de lo que cargó.
                    Clic en una fila abre la ficha 360°.
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
                        <TableHead className="text-right">Vehículos</TableHead>
                        <TableHead className="text-right">Cargue</TableHead>
                        <TableHead className="text-right">Descargue</TableHead>
                        <TableHead className="text-right">Placas</TableHead>
                        <TableHead className="text-right">T reales</TableHead>
                        <TableHead className="text-right">T/día</TableHead>
                        <TableHead className="text-right">T/vehículo</TableHead>
                        <TableHead className="text-right">% total</TableHead>
                        <TableHead className="text-right">T pagadas</TableHead>
                        <TableHead className="text-right">Real − pagada</TableHead>
                        {hayTolva && <TableHead className="text-right">T tolva</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargadores.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={15} className="py-8 text-center text-muted-foreground">Sin vehículos cerrados con equipo en el periodo.</TableCell>
                        </TableRow>
                      ) : (
                        cargadores.map((a, i) => (
                          <TableRow key={a.persona} className="cursor-pointer hover:bg-muted/40" onClick={() => setPersonaSel(a.persona)}>
                            <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                            <TableCell>
                              <span className="font-medium">{a.persona}</span>
                              {!a.activo && <Badge variant="outline" className="ml-2 text-[10px]">retirado</Badge>}
                              {a.ordenesEstimadas > 0 && <Badge variant="outline" className="ml-2 text-[10px] text-amber-700">{a.ordenesEstimadas} est.</Badge>}
                            </TableCell>
                            {!selectedEmpresaId && <TableCell className="text-xs">{a.planta ? PLANTAS[a.planta] ?? a.planta : "varias"}</TableCell>}
                            <TableCell className="text-right tabular-nums">{a.dias}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{a.vehiculos}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.vehiculosPorTipo.cargue || ""}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.vehiculosPorTipo.descargue || ""}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.placasDistintas}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{t2(a.tonReal)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.tonPorDia)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.tonPorVehiculo)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t1(a.pctDelTotal)} %</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.tonPagada)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${a.diferenciaRealPagada > 0.5 ? "text-emerald-700" : a.diferenciaRealPagada < -0.5 ? "text-red-700" : ""}`}>
                              {a.diferenciaRealPagada > 0 ? "+" : ""}
                              {t2(a.diferenciaRealPagada)}
                            </TableCell>
                            {hayTolva && <TableCell className="text-right tabular-nums text-violet-700">{a.tonTolva ? t2(a.tonTolva) : ""}</TableCell>}
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {soloPagados.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      En la lista de pago sin cargar ningún vehículo en el periodo: {soloPagados.map((a) => `${a.persona} (${t2(a.tonPagada)} t pagadas)`).join(" · ")}.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Por día ===== */}
            <TabsContent value="dia" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Toneladas por día (vehículos por tipo{hayTolva ? " · tolva aparte" : ""})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.dias.map((d) => ({ dia: diaMes(d.fecha), ...d.tonPorTipo, tolva: d.tonTolva }))} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="dia" fontSize={11} />
                        <YAxis fontSize={11} tickFormatter={(v) => t1(Number(v))} />
                        <Tooltip formatter={(v: any, name: any) => [`${t2(Number(v))} t`, TIPO_LABEL[name as TipoOp] ?? name]} />
                        <Legend formatter={(v) => TIPO_LABEL[v as TipoOp] ?? v} />
                        {tiposVehiculo.map((k) => (
                          <Bar key={k} dataKey={k} stackId="veh" fill={TIPO_COLOR[k]} />
                        ))}
                        {hayTolva && <Bar dataKey="tolva" stackId="tolva" fill={TIPO_COLOR.tolva} />}
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
                        <TableHead className="text-right">Vehículos</TableHead>
                        <TableHead className="text-right">Cargue</TableHead>
                        <TableHead className="text-right">Descargue</TableHead>
                        <TableHead className="text-right">Auxiliares reales</TableHead>
                        <TableHead className="text-right">T vehículos</TableHead>
                        <TableHead className="text-right">T por auxiliar</TableHead>
                        {hayTolva && <TableHead className="text-right">Oper. tolva</TableHead>}
                        {hayTolva && <TableHead className="text-right">T tolva</TableHead>}
                        <TableHead className="text-right">Estimadas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.dias.map((d) => (
                        <TableRow key={d.fecha}>
                          <TableCell>{fechaCorta(d.fecha)} <span className="text-[11px] text-muted-foreground">{diaSemana(d.fecha)}</span></TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{d.vehiculos || ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.vehiculosPorTipo.cargue || ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.vehiculosPorTipo.descargue || ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.auxiliares || ""}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{d.toneladas ? t2(d.toneladas) : ""}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.tonPorAuxiliar ? t2(d.tonPorAuxiliar) : ""}</TableCell>
                          {hayTolva && <TableCell className="text-right tabular-nums text-violet-700">{d.operacionesTolva || ""}</TableCell>}
                          {hayTolva && <TableCell className="text-right tabular-nums text-violet-700">{d.tonTolva ? t2(d.tonTolva) : ""}</TableCell>}
                          <TableCell className="text-right tabular-nums text-muted-foreground">{d.ordenesEstimadas || ""}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Auxiliar × día (toneladas reales en vehículos)</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background">Auxiliar</TableHead>
                        {data.fechas.map((f) => (
                          <TableHead key={f} className="text-right text-[11px]">{diaMes(f)}</TableHead>
                        ))}
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargadores.map((a) => (
                        <TableRow key={a.persona} className="cursor-pointer hover:bg-muted/40" onClick={() => setPersonaSel(a.persona)}>
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
                  <CardTitle className="text-base">Auxiliar × mes (toneladas reales en vehículos)</CardTitle>
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
                        <TableHead className="text-right">Vehículos</TableHead>
                        <TableHead className="text-right">T/día</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargadores.map((a) => (
                        <TableRow key={a.persona} className="cursor-pointer hover:bg-muted/40" onClick={() => setPersonaSel(a.persona)}>
                          <TableCell className="text-xs font-medium whitespace-nowrap">{a.persona}</TableCell>
                          {data.meses.map((m) => (
                            <TableCell key={m} className="text-right tabular-nums">{a.tonPorMes[m] ? t2(a.tonPorMes[m]) : ""}</TableCell>
                          ))}
                          <TableCell className="text-right font-semibold tabular-nums">{t2(a.tonReal)}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.vehiculos}</TableCell>
                          <TableCell className="text-right tabular-nums">{t2(a.tonPorDia)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Vehículos ===== */}
            <TabsContent value="vehiculos" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Vehículos atendidos (por placa)</CardTitle>
                  <CardDescription>Visitas = órdenes cerradas de esa placa en el periodo. “Lo atienden” = los auxiliares que más veces estuvieron en su equipo real (clic abre la ficha).</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Placa</TableHead>
                        <TableHead className="text-right">Visitas</TableHead>
                        <TableHead className="text-right">Cargue</TableHead>
                        <TableHead className="text-right">Descargue</TableHead>
                        <TableHead className="text-right">Toneladas</TableHead>
                        <TableHead className="text-right">T por visita</TableHead>
                        <TableHead>Última visita</TableHead>
                        <TableHead>Lo atienden</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.vehiculos.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Sin vehículos con placa en el periodo.</TableCell>
                        </TableRow>
                      ) : (
                        data.vehiculos.map((v) => (
                          <TableRow key={v.placa}>
                            <TableCell className="font-mono font-medium">{v.placa}</TableCell>
                            <TableCell className="text-right tabular-nums font-medium">{v.visitas}</TableCell>
                            <TableCell className="text-right tabular-nums">{v.visitasPorTipo.cargue || ""}</TableCell>
                            <TableCell className="text-right tabular-nums">{v.visitasPorTipo.descargue || ""}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(v.toneladas)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(v.tonPorVisita)}</TableCell>
                            <TableCell className="text-xs">{fechaCorta(v.ultimaVisita)}</TableCell>
                            <TableCell className="text-[11px] text-muted-foreground">
                              {v.auxiliaresFrecuentes.map((x, i) => (
                                <span key={x.persona}>
                                  {i > 0 && ", "}
                                  <button type="button" className="hover:text-primary hover:underline" onClick={() => setPersonaSel(x.persona)}>{nombreCorto(x.persona)}</button> ({x.veces})
                                </span>
                              ))}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ===== Tolva (producción, aparte) ===== */}
            {hayTolva && (
              <TabsContent value="tolva" className="mt-4 space-y-4">
                <div className="grid gap-4 xl:grid-cols-2">
                  <Podio titulo="Top tolva (producción)" icono={<Factory className="h-4 w-4" />} tipo="tolva" lista={tolveros.slice(0, 8)} onElegir={setPersonaSel} />
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Tolva en el periodo</CardTitle>
                      <CardDescription>
                        Operación de PRODUCCIÓN, no de cargue ni descargue. No pasa por el Centro de Coordinación ni tiene placa: la cuadrilla es la que trae
                        la orden y las toneladas se reparten en partes iguales entre ella. Se informa aparte y nunca se suma a los vehículos.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Operaciones</p>
                        <p className="text-2xl font-bold">{data.operacionesTolva}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Toneladas</p>
                        <p className="text-2xl font-bold">{t2(data.tonTolva)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase text-muted-foreground">Auxiliares</p>
                        <p className="text-2xl font-bold">{data.auxiliaresTolva}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <Card>
                  <CardContent className="overflow-x-auto pt-5">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Auxiliar</TableHead>
                          <TableHead className="text-right">Operaciones</TableHead>
                          <TableHead className="text-right">T tolva</TableHead>
                          <TableHead className="text-right">T por operación</TableHead>
                          <TableHead className="text-right">T en vehículos</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tolveros.map((a, i) => (
                          <TableRow key={a.persona} className="cursor-pointer hover:bg-muted/40" onClick={() => setPersonaSel(a.persona)}>
                            <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                            <TableCell className="font-medium">{a.persona}</TableCell>
                            <TableCell className="text-right tabular-nums">{a.operacionesTolva}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-violet-700">{t2(a.tonTolva)}</TableCell>
                            <TableCell className="text-right tabular-nums">{t2(a.operacionesTolva ? a.tonTolva / a.operacionesTolva : 0)}</TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">{a.tonReal ? t2(a.tonReal) : ""}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </>
      ) : null}
    </div>
  )
}

/* ======================================================================
   FICHA 360° DEL AUXILIAR
   ====================================================================== */

function Ficha360({
  persona,
  data,
  cargadores,
  mostrarPlanta,
  onVolver,
  onElegir,
}: {
  persona: AuxiliarProductividad
  data: ProductividadData
  cargadores: AuxiliarProductividad[]
  mostrarPlanta: boolean
  onVolver: () => void
  onElegir: (p: string) => void
}) {
  const posicion = cargadores.findIndex((a) => a.persona === persona.persona) + 1
  const equipoPorDia = useMemo(() => new Map(data.dias.map((d) => [d.fecha, d])), [data])
  // Promedio del equipo en los días en que ESTE auxiliar trabajó vehículos (comparación justa).
  const diasPropios = Object.keys(persona.tonPorFecha)
  const promedioEquipo = diasPropios.length ? diasPropios.reduce((s, f) => s + (equipoPorDia.get(f)?.tonPorAuxiliar ?? 0), 0) / diasPropios.length : 0
  const delta = promedioEquipo ? ((persona.tonPorDia - promedioEquipo) / promedioEquipo) * 100 : 0
  const puestoFrecuente = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of persona.asistencia) if (a.puesto) m.set(a.puesto, (m.get(a.puesto) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }, [persona])

  // Línea de tiempo: unión de días con asistencia y días con operación.
  const fechas = useMemo(() => {
    const s = new Set<string>([...persona.asistencia.map((a) => a.fecha), ...persona.ordenesDetalle.map((o) => o.fecha)])
    return [...s].sort()
  }, [persona])
  const ordenesPorFecha = useMemo(() => {
    const m = new Map<string, typeof persona.ordenesDetalle>()
    for (const o of persona.ordenesDetalle) {
      if (!m.has(o.fecha)) m.set(o.fecha, [])
      m.get(o.fecha)!.push(o)
    }
    return m
  }, [persona])
  const asistenciaPorFecha = useMemo(() => new Map(persona.asistencia.map((a) => [a.fecha, a])), [persona])
  const serie = useMemo(
    () =>
      fechas.map((f) => ({
        dia: diaMes(f),
        fecha: f,
        auxiliar: persona.tonPorFecha[f] ?? 0,
        equipo: equipoPorDia.get(f)?.tonPorAuxiliar ?? 0,
        tolva: persona.ordenesDetalle.filter((o) => o.fecha === f && o.tipo === "tolva").reduce((s, o) => s + o.tonReal, 0),
      })),
    [fechas, persona, equipoPorDia],
  )
  const Tendencia = delta > 5 ? TrendingUp : delta < -5 ? TrendingDown : Minus
  const colorDelta = delta > 5 ? "text-emerald-700" : delta < -5 ? "text-red-700" : "text-muted-foreground"

  return (
    <div className="space-y-4">
      <Card className="border-primary/40">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{persona.persona}</h2>
              {!persona.activo && <Badge variant="outline">retirado</Badge>}
              {esApoyo(persona.persona) && <Badge variant="outline">apoyo externo</Badge>}
              {(mostrarPlanta || persona.planta == null) && <Badge variant="secondary">{persona.planta ? PLANTAS[persona.planta] ?? persona.planta : "varias plantas"}</Badge>}
              {puestoFrecuente && <Badge variant="secondary">puesto habitual: {puestoFrecuente}</Badge>}
              {posicion > 0 && (
                <Badge className="gap-1">
                  <Medal className="h-3 w-3" /> #{posicion} de {cargadores.length} en vehículos
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Del {fechaCorta(data.desde)} al {fechaCorta(data.hasta)}: {persona.vehiculos} vehículos en {persona.dias} días, {t2(persona.tonReal)} t reales
              ({t1(persona.pctDelTotal)} % del total), {t2(persona.tonPorDia)} t por día frente a {t2(promedioEquipo)} t del promedio del equipo en sus mismos días.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onVolver} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" /> Volver al equipo
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<Scale className="h-4 w-4" />} label="Toneladas en vehículos" valor={`${t2(persona.tonReal)} t`} nota={`cargue ${t1(persona.tonPorTipo.cargue)} · descargue ${t1(persona.tonPorTipo.descargue)}${persona.tonPorTipo.distribucion ? ` · distrib. ${t1(persona.tonPorTipo.distribucion)}` : ""}`} />
        <Kpi icon={<Truck className="h-4 w-4" />} label="Vehículos atendidos" valor={String(persona.vehiculos)} nota={`${persona.vehiculosPorTipo.cargue} cargue · ${persona.vehiculosPorTipo.descargue} descargue · ${persona.placasDistintas} placas · ${t2(persona.tonPorVehiculo)} t/vehículo`} />
        <Kpi
          icon={<CalendarDays className="h-4 w-4" />}
          label="Días"
          valor={`${persona.dias} con operación`}
          nota={`${persona.diasProgramadosCargue} programados en cargue/descargue${persona.diasProgramadosSinVehiculo ? ` · ${persona.diasProgramadosSinVehiculo} de ellos sin vehículo` : ""}`}
          alerta={persona.diasProgramadosSinVehiculo > 0}
        />
        <Kpi
          icon={<Tendencia className={`h-4 w-4 ${colorDelta}`} />}
          label="Frente al equipo"
          valor={`${delta > 0 ? "+" : ""}${t1(delta)} %`}
          nota={`${t2(persona.tonPorDia)} t/día vs ${t2(promedioEquipo)} t/día promedio en sus días`}
        />
        <Kpi
          icon={<Users className="h-4 w-4" />}
          label="Real vs pagado"
          valor={`${persona.diferenciaRealPagada > 0 ? "+" : ""}${t2(persona.diferenciaRealPagada)} t`}
          nota={`cargó ${t2(persona.tonReal)} t · nómina le repartió ${t2(persona.tonPagada)} t${persona.operacionesTolva ? ` · tolva aparte: ${t2(persona.tonTolva)} t en ${persona.operacionesTolva} oper.` : ""}`}
          alerta={Math.abs(persona.diferenciaRealPagada) > 5}
        />
      </div>

      {serie.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Toneladas por día: {nombreCorto(persona.persona)} frente al promedio del equipo</CardTitle>
            <CardDescription>Barras = toneladas reales del auxiliar en vehículos ese día. Línea = promedio por auxiliar del equipo ese día.{persona.operacionesTolva ? " Barras moradas = tolva (producción), aparte." : ""}</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="dia" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => t1(Number(v))} />
                  <Tooltip formatter={(v: any, name: any) => [`${t2(Number(v))} t`, name === "auxiliar" ? nombreCorto(persona.persona) : name === "equipo" ? "Promedio del equipo" : "Tolva"]} />
                  <Legend formatter={(v) => (v === "auxiliar" ? nombreCorto(persona.persona) : v === "equipo" ? "Promedio del equipo" : "Tolva (producción)")} />
                  <Bar dataKey="auxiliar" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  {persona.operacionesTolva > 0 && <Bar dataKey="tolva" fill={TIPO_COLOR.tolva} radius={[4, 4, 0, 0]} />}
                  <Line type="monotone" dataKey="equipo" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4" /> Dónde estuvo, día por día
          </CardTitle>
          <CardDescription>Programación y asistencia (Programación de Turnos) junto a lo que realmente cargó ese día y cómo se compara con el promedio del equipo.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Puesto programado</TableHead>
                <TableHead>Novedad</TableHead>
                <TableHead>Horario</TableHead>
                <TableHead className="text-right">Vehículos</TableHead>
                <TableHead>Placas</TableHead>
                <TableHead className="text-right">T reales</TableHead>
                <TableHead className="text-right">Prom. equipo</TableHead>
                <TableHead className="text-right">Dif.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fechas.map((f) => {
                const a = asistenciaPorFecha.get(f)
                const ords = (ordenesPorFecha.get(f) ?? []).filter((o) => o.tipo !== "tolva")
                const tolvaDia = (ordenesPorFecha.get(f) ?? []).filter((o) => o.tipo === "tolva").length
                const t = persona.tonPorFecha[f] ?? 0
                const eq = equipoPorDia.get(f)?.tonPorAuxiliar ?? 0
                const d = t - eq
                const programadoSinVehiculo = a && /cargue|descargue/i.test(a.puesto ?? "") && ords.length === 0
                return (
                  <TableRow key={f} className={programadoSinVehiculo ? "bg-amber-50/60" : a?.novedad ? "bg-muted/30" : ""}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {fechaCorta(f)} <span className="text-muted-foreground">{diaSemana(f)}</span>
                    </TableCell>
                    <TableCell className="text-xs">{a?.puesto ?? <span className="text-muted-foreground">sin programación</span>}</TableCell>
                    <TableCell className="text-xs">{a?.novedad ?? ""}</TableCell>
                    <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                      {a?.entradaReal || a?.salidaReal ? `${a.entradaReal ?? "?"}–${a.salidaReal ?? "?"}` : a?.entradaProgramada ? `${a.entradaProgramada}–${a.salidaProgramada ?? "?"} (prog.)` : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ords.length || ""}
                      {tolvaDia ? <span className="ml-1 text-[10px] text-violet-700">+{tolvaDia} tolva</span> : null}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{[...new Set(ords.map((o) => o.placa).filter(Boolean))].join(" ")}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{t ? t2(t) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{eq ? t2(eq) : ""}</TableCell>
                    <TableCell className={`text-right tabular-nums ${t && d > 0.5 ? "text-emerald-700" : t && d < -0.5 ? "text-red-700" : "text-muted-foreground"}`}>
                      {t ? `${d > 0 ? "+" : ""}${t2(d)}` : programadoSinVehiculo ? "sin vehículo" : ""}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Con quién trabaja más
            </CardTitle>
            <CardDescription>Compañeros con los que más veces compartió equipo real (y toneladas conjuntas de él en esos vehículos).</CardDescription>
          </CardHeader>
          <CardContent>
            {persona.companeros.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin compañeros registrados en el periodo.</p>
            ) : (
              <ul className="space-y-1.5">
                {persona.companeros.map((c, i) => (
                  <li key={c.nombre} className="flex items-center gap-2 text-sm">
                    <span className="w-5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <button type="button" className="flex-1 truncate text-left hover:text-primary hover:underline" onClick={() => onElegir(c.nombre)}>
                      {c.nombre}
                    </button>
                    <span className="text-xs text-muted-foreground">{c.veces} veces · {t1(c.toneladas)} t</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4" /> Vehículos que más atiende
            </CardTitle>
            <CardDescription>Placas con más visitas atendidas por él en el periodo.</CardDescription>
          </CardHeader>
          <CardContent>
            {persona.placasTop.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin vehículos con placa en el periodo.</p>
            ) : (
              <ul className="space-y-1.5">
                {persona.placasTop.map((p, i) => (
                  <li key={p.nombre} className="flex items-center gap-2 text-sm">
                    <span className="w-5 font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="flex-1 font-mono">{p.nombre}</span>
                    <span className="text-xs text-muted-foreground">{p.veces} visitas · {t1(p.toneladas)} t</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Órdenes del periodo</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Orden</TableHead>
                <TableHead>Operación</TableHead>
                {mostrarPlanta && <TableHead>Planta</TableHead>}
                <TableHead>Placa</TableHead>
                <TableHead className="text-right">Peso</TableHead>
                <TableHead className="text-right">Equipo</TableHead>
                <TableHead className="text-right">T real</TableHead>
                <TableHead>Con quién</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {persona.ordenesDetalle.map((o) => (
                <TableRow key={`${o.orden}-${o.fecha}`} className={o.tipo === "tolva" ? "bg-violet-50/40" : ""}>
                  <TableCell className="text-xs">{fechaCorta(o.fecha)}</TableCell>
                  <TableCell className="font-mono text-xs">{o.orden}</TableCell>
                  <TableCell className="text-xs">{o.tipooperacion}</TableCell>
                  {mostrarPlanta && <TableCell className="text-xs">{PLANTAS[o.planta] ?? o.planta}</TableCell>}
                  <TableCell className="font-mono text-xs">{o.placa ?? ""}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{t2(o.peso)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{o.nReal}{o.estimada ? " *" : ""}</TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">{t2(o.tonReal)}</TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {o.crew.filter((c) => c !== persona.persona).map((c, i) => (
                      <span key={c}>
                        {i > 0 && ", "}
                        <button type="button" className="hover:text-primary hover:underline" onClick={() => onElegir(c)}>{nombreCorto(c)}</button>
                      </span>
                    ))}
                    {o.crew.length <= 1 && "solo"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {persona.ordenesEstimadas > 0 && <p className="mt-2 text-[11px] text-muted-foreground">* Vehículo sin equipo real registrado: se usó la lista de pago.</p>}
        </CardContent>
      </Card>
    </div>
  )
}

/* ======================================================================
   Piezas compartidas
   ====================================================================== */

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

/** Tarjeta por tipo de operación: mismas cifras que el podio y el ranking de ese tipo. */
function TarjetaTipo({
  tipo,
  icono,
  ton,
  ops,
  aux,
  lider,
  unidad,
  nota,
  onElegir,
}: {
  tipo: TipoOp
  icono: React.ReactNode
  ton: number
  ops: number
  aux: number
  lider?: AuxiliarProductividad
  unidad: string
  nota?: string
  onElegir: (p: string) => void
}) {
  const tonLider = lider ? (tipo === "tolva" ? lider.tonTolva : lider.tonPorTipo[tipo]) : 0
  const opsLider = lider ? (tipo === "tolva" ? lider.operacionesTolva : lider.vehiculosPorTipo[tipo]) : 0
  return (
    <Card style={{ borderTopColor: TIPO_COLOR[tipo], borderTopWidth: 3 }}>
      <CardContent className="pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase" style={{ color: TIPO_COLOR[tipo] }}>
          {icono} {TIPO_LABEL[tipo]}
        </p>
        <p className="mt-1 text-2xl font-bold">
          {t2(ton)} <span className="text-sm font-normal text-muted-foreground">t</span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          {ops} {unidad} · {aux} auxiliares{ops ? ` · ${t2(ton / ops)} t por ${unidad === "vehículos" ? "vehículo" : "operación"}` : ""}
        </p>
        {lider && tonLider > 0 ? (
          <button type="button" onClick={() => onElegir(lider.persona)} className="mt-2 flex items-center gap-1 text-left text-xs hover:text-primary">
            <Medal className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="truncate" title={lider.persona}>
              <b>{nombreCorto(lider.persona)}</b>: {t2(tonLider)} t en {opsLider} {unidad}
            </span>
          </button>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Sin operaciones en el periodo</p>
        )}
        {nota && <p className="mt-1 text-[10px] text-muted-foreground">{nota}</p>}
      </CardContent>
    </Card>
  )
}

const MEDALLA = ["text-amber-500", "text-slate-400", "text-amber-700"]

function Podio({
  titulo,
  icono,
  tipo,
  lista,
  onElegir,
}: {
  titulo: string
  icono: React.ReactNode
  tipo: TipoOp
  lista: AuxiliarProductividad[]
  onElegir: (persona: string) => void
}) {
  const tonDe = (a: AuxiliarProductividad) => (tipo === "tolva" ? a.tonTolva : a.tonPorTipo[tipo])
  const opsDe = (a: AuxiliarProductividad) => (tipo === "tolva" ? a.operacionesTolva : a.vehiculosPorTipo[tipo])
  const unidad = tipo === "tolva" ? "oper" : "veh"
  const total = lista.reduce((s, a) => s + tonDe(a), 0)
  const max = lista[0] ? tonDe(lista[0]) || 1 : 1
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icono} {titulo}
        </CardTitle>
        <CardDescription>{lista.length ? `${lista.length} auxiliares · toneladas reales de ${TIPO_LABEL[tipo].toLowerCase()} · clic abre la ficha 360°` : "Sin operaciones de este tipo en el periodo"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {lista.map((a, i) => {
          const t = tonDe(a)
          const v = opsDe(a)
          return (
            <button key={a.persona} type="button" onClick={() => onElegir(a.persona)} className="block w-full rounded-md p-1.5 text-left hover:bg-muted/50">
              <div className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center">
                  {i < 3 ? <Medal className={`inline h-4 w-4 ${MEDALLA[i]}`} /> : <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>}
                </span>
                <span className={`flex-1 truncate ${i === 0 ? "font-semibold" : "text-sm"}`} title={a.persona}>{a.persona}</span>
                <span className={`shrink-0 tabular-nums ${i === 0 ? "text-base font-bold" : "text-sm font-medium"}`}>{t2(t)} t</span>
              </div>
              <div className="ml-8 mt-0.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${Math.max(2, (t / max) * 100)}%`, background: TIPO_COLOR[tipo] }} />
                </div>
                <span className="w-[140px] shrink-0 text-right text-[11px] text-muted-foreground">
                  {v} {unidad} · {a.dias} días · {t2(a.dias ? t / a.dias : 0)} t/día
                </span>
              </div>
            </button>
          )
        })}
        {total > 0 && <p className="pt-1 text-right text-[11px] text-muted-foreground">Estos {lista.length} suman {t2(total)} t</p>}
      </CardContent>
    </Card>
  )
}
