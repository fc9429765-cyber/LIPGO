"use client"

import { useEffect, useMemo, useState } from "react"
import { usePortal } from "@/components/portal/portal-provider"
import {
  getBalanceToneladasYHoras,
  type PortalBalanceDia,
} from "@/lib/portal-actions"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  BarChart3,
  CalendarRange,
  ChevronDown,
  Clock4,
  Loader2,
  RotateCcw,
  Truck,
} from "lucide-react"

/**
 * Balance de toneladas y horas extra del trabajador autenticado.
 *
 * Esta vista combina dos fuentes (ver `getBalanceToneladasYHoras`):
 *  - `toneladasauxiliares` filtrada por nombre del colaborador, igual
 *    que el modulo admin "Detalle Toneladas" en `nominapersonal.tsx`.
 *  - `registroasistencia` para las horas extra del dia
 *    (hed/hedf/hen/hef/hn). Estas columnas no estan en
 *    `toneladasauxiliares`, por eso se cruzan por fecha.
 *
 * El listado es linea-por-linea con expand/collapse: cada dia muestra
 * fecha + total toneladas + total horas extra y, al desplegar, la
 * tabla de ordenes de cargue (Orden, Tipo Op., Peso Op., Aux.,
 * Toneladas) seguida del desglose de horas extra.
 */
export default function PortalBalancePage() {
  const { colaborador } = usePortal()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dias, setDias] = useState<PortalBalanceDia[]>([])

  // Filtros: Mes ("YYYY-MM" | "all") y Quincena. La quincena se
  // ignora cuando Mes = "all" (no tiene sentido mezclar quincenas de
  // distintos meses).
  const [mes, setMes] = useState<string>("all")
  const [quincena, setQuincena] = useState<"all" | "1" | "2">("all")

  useEffect(() => {
    if (!colaborador) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      const res = await getBalanceToneladasYHoras({
        idempresa: colaborador.idempresa,
        nombre: colaborador.nombre,
      })
      if (cancelled) return
      if (!res.success) {
        setError(res.error || "No se pudo cargar tu balance.")
        setDias([])
      } else {
        setDias(res.data)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [colaborador])

  // Meses disponibles ordenados desc para que el reciente quede arriba.
  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const d of dias) {
      if (d.fecha && d.fecha.length >= 7) set.add(d.fecha.slice(0, 7))
    }
    return Array.from(set).sort().reverse()
  }, [dias])

  // Filtro client-side por mes + quincena.
  const filteredDias = useMemo(() => {
    return dias.filter((d) => {
      if (mes !== "all") {
        if (d.fecha.slice(0, 7) !== mes) return false
        if (quincena !== "all") {
          const dia = Number(d.fecha.slice(8, 10))
          if (!Number.isFinite(dia)) return false
          if (quincena === "1" && dia > 15) return false
          if (quincena === "2" && dia <= 15) return false
        }
      }
      return true
    })
  }, [dias, mes, quincena])

  // KPIs del periodo filtrado.
  const totals = useMemo(() => {
    let toneladas = 0
    let horasExtra = 0
    let diasTrabajados = 0
    for (const d of filteredDias) {
      toneladas += d.total_toneladas
      horasExtra += d.total_horas_extra
      if (d.total_toneladas > 0 || d.total_horas_extra > 0) diasTrabajados++
    }
    return { toneladas, horasExtra, diasTrabajados }
  }, [filteredDias])

  const handleLimpiar = () => {
    setMes("all")
    setQuincena("all")
  }

  return (
    <div className="space-y-6 pb-4">
      {/* Header de presentacion */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5">
              <BarChart3 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">
                Balance de toneladas y horas extra
              </CardTitle>
              <CardDescription className="mt-1">
                Tu historial diario de cargues y horas extras registradas.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-3">
        <KpiCard
          icon={Truck}
          label="Toneladas"
          value={formatNumber(totals.toneladas, 2)}
          accent="text-emerald-700 bg-emerald-50"
        />
        <KpiCard
          icon={Clock4}
          label="Horas extra"
          value={formatNumber(totals.horasExtra, 2)}
          accent="text-amber-700 bg-amber-50"
        />
        <KpiCard
          icon={BarChart3}
          label="Días"
          value={String(totals.diasTrabajados)}
          accent="text-blue-700 bg-blue-50"
        />
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarRange className="h-4 w-4 text-primary" />
            Filtrar por fechas
          </CardTitle>
          <CardDescription>
            Acota el listado para revisar un periodo especifico.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="balance-mes" className="text-xs">
                Mes
              </Label>
              <Select value={mes} onValueChange={(v) => setMes(v)}>
                <SelectTrigger id="balance-mes">
                  <SelectValue placeholder="Selecciona un mes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los meses</SelectItem>
                  {mesesDisponibles.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatMonthLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="balance-quincena" className="text-xs">
                Quincena
              </Label>
              <Select
                value={quincena}
                onValueChange={(v) => setQuincena(v as "all" | "1" | "2")}
                disabled={mes === "all"}
              >
                <SelectTrigger id="balance-quincena">
                  <SelectValue placeholder="Quincena" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo el mes</SelectItem>
                  <SelectItem value="1">Primera (1 - 15)</SelectItem>
                  <SelectItem value="2">Segunda (16 - fin)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={handleLimpiar}
              disabled={mes === "all" && quincena === "all"}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista diaria */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Resumen diario</CardTitle>
          <CardDescription>
            {filteredDias.length}{" "}
            {filteredDias.length === 1 ? "dia" : "dias"} en el periodo
            seleccionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              {error}
            </div>
          ) : filteredDias.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <BarChart3 className="h-10 w-10 text-muted-foreground" />
                <EmptyTitle>Sin movimientos</EmptyTitle>
                <EmptyDescription>
                  No encontramos toneladas ni horas extra en este periodo.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-2">
              {filteredDias.map((d) => (
                <BalanceDiaRow key={d.fecha} dia={d} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Tarjeta de un dia con expand/collapse:
 *   - Cerrada: una sola linea con fecha (izq) + bloque toneladas
 *     (verde) + bloque horas extra (ambar) + chevron.
 *   - Abierta: tabla compacta de ordenes (Orden, Tipo Op., Peso Op.,
 *     Aux., Toneladas) y desglose de horas extra (HED/HEDF/HEN/HEF/HN).
 *
 * Cada CollapsibleTrigger es la fila completa para ofrecer un area
 * de tap grande en mobile.
 */
function BalanceDiaRow({ dia }: { dia: PortalBalanceDia }) {
  const tieneOrdenes = dia.ordenes.length > 0
  const tieneHoras = dia.total_horas_extra > 0
  return (
    <Card className="overflow-hidden py-0">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 data-[state=open]:bg-muted/40">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {formatDate(dia.fecha)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {dia.ordenes.length === 0
                ? "Sin cargues"
                : `${dia.ordenes.length} orden${
                    dia.ordenes.length === 1 ? "" : "es"
                  }`}
            </p>
          </div>
          {/* Solo mostramos los chips de totales cuando son > 0.
              Mostrar "0.00" en mobile agrega ruido visual y desplaza
              el chevron sin aportar informacion (el detalle expandido
              ya cubre el caso "sin movimientos"). */}
          {dia.total_toneladas > 0 ? (
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wide text-emerald-700/80 leading-tight">
                Tons.
              </p>
              <p className="text-sm font-bold tabular-nums text-emerald-700 leading-tight">
                {formatNumber(dia.total_toneladas, 2)}
              </p>
            </div>
          ) : null}
          {dia.total_horas_extra > 0 ? (
            <div className="text-right shrink-0">
              <p className="text-[10px] uppercase tracking-wide text-amber-700/80 leading-tight">
                H. extra
              </p>
              <p className="text-sm font-bold tabular-nums text-amber-700 leading-tight">
                {formatNumber(dia.total_horas_extra, 2)}
              </p>
            </div>
          ) : null}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 shrink-0" />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t bg-muted/20 px-2 py-2 space-y-2">
            {/* Tabla de ordenes de cargue del dia.
                Truncamos `tipooperacion` con max-width para que el
                texto largo no expanda la tabla en mobile. */}
            {tieneOrdenes ? (
              <div className="rounded-md border bg-background overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] py-1.5 px-2">
                          Orden
                        </TableHead>
                        <TableHead className="text-[11px] py-1.5 px-2">
                          Tipo Op.
                        </TableHead>
                        <TableHead className="text-[11px] py-1.5 px-2 text-right">
                          Peso Op.
                        </TableHead>
                        <TableHead className="text-[11px] py-1.5 px-2 text-right">
                          Aux.
                        </TableHead>
                        <TableHead className="text-[11px] py-1.5 px-2 text-right">
                          Toneladas
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dia.ordenes.map((o, idx) => (
                        <TableRow
                          key={`${o.ordendecargue}-${idx}`}
                          className="border-b last:border-0"
                        >
                          <TableCell className="text-[11px] py-1.5 px-2 font-medium">
                            {o.ordendecargue || "-"}
                          </TableCell>
                          <TableCell className="text-[11px] py-1.5 px-2 text-muted-foreground max-w-[100px] truncate">
                            {o.tipooperacion || "-"}
                          </TableCell>
                          <TableCell className="text-[11px] py-1.5 px-2 text-right tabular-nums">
                            {formatNumber(o.peso_total_operacion, 2)}
                          </TableCell>
                          <TableCell className="text-[11px] py-1.5 px-2 text-right tabular-nums">
                            {o.cantidad_auxiliares ?? 0}
                          </TableCell>
                          <TableCell className="text-[11px] py-1.5 px-2 text-right tabular-nums font-semibold text-emerald-700">
                            {formatNumber(o.toneladas_auxiliar, 2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            {/* Desglose de horas extra. Solo se muestra si alguna > 0. */}
            {tieneHoras ? (
              <div className="rounded-md border bg-background px-3 py-2 text-xs">
                <p className="text-[10px] uppercase tracking-wide text-amber-700/80 mb-1.5">
                  Horas extra
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <DetailLine label="HED" value={formatNumber(dia.hed, 2)} />
                  <DetailLine label="HEDF" value={formatNumber(dia.hedf, 2)} />
                  <DetailLine label="HEN" value={formatNumber(dia.hen, 2)} />
                  <DetailLine label="HEF" value={formatNumber(dia.hef, 2)} />
                  <DetailLine label="HN" value={formatNumber(dia.hn, 2)} />
                  <DetailLine
                    label="Total"
                    value={formatNumber(dia.total_horas_extra, 2)}
                    strong
                  />
                </div>
              </div>
            ) : null}

            {!tieneOrdenes && !tieneHoras ? (
              <p className="text-center text-xs text-muted-foreground py-2">
                Sin movimientos registrados.
              </p>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

/** KPI compacto: icono + label + valor. */
function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  accent: string
}) {
  return (
    <Card>
      {/*
        En mobile (< sm, ej. 381px) tenemos solo ~115px por tarjeta
        cuando son 3 en fila. Con icono + texto en flex-row el valor
        ("12,345.67" toneladas) no cabe y queda truncado. Apilamos
        vertical en mobile (icono arriba, label corto, valor grande
        debajo) y volvemos a horizontal a partir de sm donde si hay
        espacio suficiente.
      */}
      <CardContent className="flex flex-col items-start gap-1.5 p-3 sm:flex-row sm:items-center sm:gap-2">
        <div className={`rounded-lg p-2 shrink-0 ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 w-full">
          <p className="lg-eyebrow leading-tight">
            {label}
          </p>
          {/* Sin `truncate` para que no recorte cifras: el contenedor
              ya es ancho completo de la celda y `tabular-nums` mantiene
              el alineado. Si hay overflow real cae a wrap. */}
          <p className="text-base font-semibold tabular-nums leading-tight break-words">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/** Fila "label : value" para el desglose de horas extra. */
function DetailLine({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`tabular-nums ${
          strong ? "font-semibold text-primary" : "font-medium text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * "YYYY-MM-DD" -> "DD/MM/YYYY". No usamos `new Date(iso)` para evitar
 * el desfase de un dia por interpretacion UTC.
 */
function formatDate(iso: string | null): string {
  if (!iso) return "-"
  const parts = iso.split("-")
  if (parts.length !== 3) return iso
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

/** "YYYY-MM" -> "Mes YYYY" capitalizado en es-CO. */
function formatMonthLabel(ym: string): string {
  const parts = ym.split("-")
  if (parts.length !== 2) return ym
  const y = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(y) || !Number.isFinite(m)) return ym
  const d = new Date(y, m - 1, 1)
  const label = d.toLocaleDateString("es-CO", {
    month: "long",
    year: "numeric",
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** Formatea numero con separadores de miles y `decimals` decimales. */
function formatNumber(n: number | null | undefined, decimals = 2): string {
  const v = Number(n) || 0
  return v.toLocaleString("es-CO", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
