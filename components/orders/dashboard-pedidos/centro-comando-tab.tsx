"use client"

import { useMemo } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CheckCircle2,
  DollarSign,
  Gauge,
  Inbox,
  Package,
  PackageCheck,
  Truck,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiCard } from "./kpi-card"
import { PeriodFilter, usePeriodFilter } from "./period-filter"
import {
  calcEntregasATiempoPct,
  calcInFullPct,
  calcOtifGlobalPct,
  calcResumenEntregas,
  calcTopClientes,
  calcTopDestinos,
  calcTopVendedores,
  fmtCOP,
  fmtFloat1,
  fmtInt,
  fmtPct,
} from "./calculations"
import type { PedidoCabecera, PedidoDetalle } from "./types"

interface Props {
  cabecera: PedidoCabecera[]
  detalle: PedidoDetalle[]
}

/**
 * Tab 1: Centro de Comando Operativo.
 *
 * Layout Bento (responsive, prioriza flexbox/grid sin floats):
 *   Fila 1: 4 KPI cards con footer informativo (KPIs ejecutivos del periodo).
 *   Fila 2: "Cierre del Día" — 4 tiles + lista de pedidos entregados hoy.
 *           Esta tarjeta SIEMPRE refleja el dia actual (Bogota), aunque el
 *           filtro de periodo este puesto en otro mes/año, porque el cierre
 *           diario es una vista de "que paso hoy" independiente del historico.
 *   Fila 3: Top 5 Destinos / Vendedores / Clientes (1/3 cada uno).
 *
 * Todos los calculos en `useMemo` para evitar recomputos al cambiar de
 * tab o al hacer hover en charts.
 */
export function CentroComandoTab({ cabecera, detalle }: Props) {
  const filter = usePeriodFilter(cabecera, detalle)
  const cab = filter.filteredCabecera
  const det = filter.filteredDetalle

  const kpis = useMemo(() => {
    const resumenEntregas = calcResumenEntregas(cab)
    const evaluables =
      resumenEntregas.aTiempo + resumenEntregas.atrasados
    return {
      entregasATiempo: calcEntregasATiempoPct(cab),
      inFull: calcInFullPct(det),
      otif: calcOtifGlobalPct(cab, det),
      resumenEntregas,
      evaluablesEntrega: evaluables,
    }
  }, [cab, det])

  // Volumen Despachado (KPI): suma de `pedidosdetalle.peso` / 1000 sobre
  // el periodo filtrado. Calculo directo (sin pasar por la serie diaria)
  // para no acoplar este KPI al chart removido.
  const volumenToneladas = useMemo(() => {
    let kg = 0
    for (const d of det) kg += Number(d.peso) || 0
    return kg / 1000
  }, [det])

  // Top 5 destinos por numero de despachos (campo `destino` de la cabecera).
  const topDestinos = useMemo(() => calcTopDestinos(cab, 5), [cab])
  const topVendedores = useMemo(() => calcTopVendedores(cab, 5), [cab])
  const topClientes = useMemo(() => calcTopClientes(cab, 5), [cab])

  // ──────────────────────────────────────────────────────────────────
  // Cierre — vista de "qué se cerró" en una ventana de tiempo:
  //   - Sin filtro de periodo: ventana = HOY (Bogota), modo "en vivo".
  //   - Con filtro de año/mes/día: la ventana pasa a ser TODO el periodo
  //     seleccionado (Cierre del Año / Mes / Día), recomputando sobre la
  //     data COMPLETA ya cargada (paginada hasta el historico completo),
  //     por lo que no hay limitacion por cantidad de datos.
  //
  // El calculo siempre parte de la data original (cabecera/detalle), no
  // de la filtrada por `fechadeentrega`, porque "ingresados" se mide por
  // fecha de creacion (`fecha`) y "entregados" por `fechadeentrega`, y
  // necesitamos ambas dimensiones dentro del mismo periodo.
  // ──────────────────────────────────────────────────────────────────
  const cierre = useMemo(() => {
    // Hoy en Bogota como prefijo "YYYY-MM-DD".
    const hoyPrefix = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Bogota",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())

    // Prefijo de comparacion segun el periodo activo. La granularidad
    // del prefijo define el alcance del cierre.
    let prefix = hoyPrefix
    let scope: "dia-hoy" | "dia" | "mes" | "anio" = "dia-hoy"
    if (filter.isActive && filter.year !== "all") {
      const y = String(filter.year)
      if (filter.month !== "all") {
        const mm = String(filter.month).padStart(2, "0")
        if (filter.day !== "all") {
          prefix = `${y}-${mm}-${String(filter.day).padStart(2, "0")}`
          scope = "dia"
        } else {
          prefix = `${y}-${mm}`
          scope = "mes"
        }
      } else {
        prefix = y
        scope = "anio"
      }
    }

    // Compara el inicio del string ISO contra el prefijo del periodo.
    const inPeriod = (val?: string | null) =>
      !!val && val.slice(0, prefix.length) === prefix

    // Pedidos que INGRESARON en el periodo = creados (campo `fecha`).
    const ingresados = cabecera.filter((p) => inPeriod(p.fecha))

    // Pedidos ENTREGADOS en el periodo = `fechadeentrega` cae en el rango.
    const entregados = cabecera.filter((p) => inPeriod(p.fechadeentrega))

    // Cumplimiento = sum(unidadescargadas) / sum(unidades) de entregados.
    let unidadesPedidas = 0
    let unidadesCargadas = 0
    if (entregados.length > 0) {
      const idsEntregados = new Set(entregados.map((p) => p.idpedido))
      for (const d of detalle) {
        if (!idsEntregados.has(d.idpedido)) continue
        unidadesPedidas += Number(d.unidades) || 0
        unidadesCargadas += Number(d.unidadescargadas) || 0
      }
    }
    const cumplimiento =
      unidadesPedidas > 0 ? (unidadesCargadas / unidadesPedidas) * 100 : 0

    // Facturacion del periodo = sum(total_pagar) de los entregados.
    let facturacion = 0
    for (const p of entregados) facturacion += Number(p.total_pagar) || 0

    // Mapa idpedido -> { pedidas, cargadas } para no recorrer `detalle`
    // por cada pedido (importante cuando el periodo trae miles de filas).
    const idsEntregados = new Set(entregados.map((p) => p.idpedido))
    const unidadesPorPedido = new Map<number, { pedidas: number; cargadas: number }>()
    for (const d of detalle) {
      if (!idsEntregados.has(d.idpedido)) continue
      const acc = unidadesPorPedido.get(d.idpedido) || { pedidas: 0, cargadas: 0 }
      acc.pedidas += Number(d.unidades) || 0
      acc.cargadas += Number(d.unidadescargadas) || 0
      unidadesPorPedido.set(d.idpedido, acc)
    }

    // Lista completa de entregados ordenada por monto (mayor primero).
    // No se trunca: la UI la muestra en un contenedor con scroll.
    const entregadosLista = entregados
      .map((p) => {
        const u = unidadesPorPedido.get(p.idpedido) || { pedidas: 0, cargadas: 0 }
        const pct = u.pedidas > 0 ? (u.cargadas / u.pedidas) * 100 : 0
        return {
          idpedido: p.idpedido,
          pedido: p.pedido || `#${p.idpedido}`,
          cliente: (p.cliente || "Sin cliente").trim() || "Sin cliente",
          factura: (p.factura || "").trim(),
          total: Number(p.total_pagar) || 0,
          unidadesPedidas: u.pedidas,
          unidadesCargadas: u.cargadas,
          cumplimientoPct: pct,
        }
      })
      .sort((a, b) => b.total - a.total)

    return {
      prefix,
      scope,
      ingresados: ingresados.length,
      entregados: entregados.length,
      cumplimiento,
      facturacion,
      entregadosLista,
    }
  }, [cabecera, detalle, filter.isActive, filter.year, filter.month, filter.day])

  // Titulo + etiqueta humana del periodo + si es vista "en vivo" (hoy).
  const cierreInfo = useMemo(() => {
    if (cierre.scope === "anio") {
      return { title: "Cierre del Año", label: `Año ${cierre.prefix}`, live: false }
    }
    if (cierre.scope === "mes") {
      const nombreMes = new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        month: "long",
        year: "numeric",
      })
        .format(new Date(`${cierre.prefix}-01T12:00:00Z`))
        .replace(/^./, (ch) => ch.toUpperCase())
      return { title: "Cierre del Mes", label: nombreMes, live: false }
    }
    // dia / dia-hoy
    const label = new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
      .format(new Date(`${cierre.prefix}T12:00:00Z`))
      .replace(/^./, (ch) => ch.toUpperCase())
    return { title: "Cierre del Día", label, live: cierre.scope === "dia-hoy" }
  }, [cierre.scope, cierre.prefix])

  // Texto contextual segun si la ventana es "hoy" o un periodo historico.
  const periodoHint = cierreInfo.live ? "hoy" : "en el periodo"

  const truncCliente = (s: string) =>
    s.length > 22 ? `${s.slice(0, 21)}…` : s

  return (
    <div className="space-y-4">
      <PeriodFilter
        year={filter.year}
        month={filter.month}
        day={filter.day}
        setYear={filter.setYear}
        setMonth={filter.setMonth}
        setDay={filter.setDay}
        years={filter.years}
        days={filter.days}
        reset={filter.reset}
        isActive={filter.isActive}
        totalPedidos={filter.meta.totalPedidos}
        filteredPedidos={filter.meta.filteredPedidos}
      />

      {/* Fila 1: KPIs con footer informativo */}
      {/* Fila 1: KPIs principales (4 columnas en xl tras quitar
          "Costo de Demoras"). Manteniendo grid-cols-3 en lg para
          que las tarjetas no se vean apretadas en monitores medianos. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Entregas a Tiempo"
          value={fmtPct(kpis.entregasATiempo)}
          icon={CheckCircle2}
          variant="success"
          subtext="fechaordencargue ≤ programada"
          footer={
            <KpiBreakdown
              items={[
                {
                  label: "A tiempo",
                  value: kpis.resumenEntregas.aTiempo,
                  tone: "success",
                },
                {
                  label: "Tarde",
                  value: kpis.resumenEntregas.atrasados,
                  tone: "danger",
                },
              ]}
              total={kpis.evaluablesEntrega}
            />
          }
        />
        <KpiCard
          label="In-Full (Completos)"
          value={fmtPct(kpis.inFull)}
          icon={PackageCheck}
          variant="primary"
          subtext={`${fmtInt(det.length)} líneas analizadas`}
        />
        <KpiCard
          label="OTIF Global"
          value={fmtPct(kpis.otif)}
          icon={Package}
          variant="success"
          subtext="a tiempo + completo"
        />
        <KpiCard
          label="Volumen Despachado"
          value={`${fmtFloat1(volumenToneladas)} t`}
          icon={Truck}
          variant="warning"
          subtext={`${fmtInt(volumenToneladas * 1000)} kg pedidos`}
        />
      </div>

      {/* Fila 2: Cierre del Día / Mes / Año.
          Sin filtro refleja "qué pasó HOY" (en vivo). Al aplicar un
          filtro de año/mes/día, la tarjeta se re-renderiza (key={cierre.prefix})
          y pasa a mostrar el cierre de TODO el periodo seleccionado,
          recorriendo la data historica completa ya cargada.
          4 tiles compactos arriba (Ingresados / Entregados / Cumplimiento /
          Facturacion) y debajo, la lista de pedidos entregados en el
          periodo con su % de cumplimiento por linea. */}
      <Card key={cierre.prefix} className="border-border/60">
        <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              {cierreInfo.title}
              {cierreInfo.live ? (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[color-mix(in_oklch,var(--chart-3)_14%,transparent)] text-[var(--chart-3)] uppercase tracking-wide">
                  En vivo
                </span>
              ) : (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                  Histórico
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {cierreInfo.label}
              {cierreInfo.live ? (
                <>
                  {" "}
                  · zona horaria{" "}
                  <code className="rounded bg-muted px-1">America/Bogota</code>
                </>
              ) : null}
            </p>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* Tiles del cierre */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CierreTile
              icon={Inbox}
              label="Ingresaron"
              value={fmtInt(cierre.ingresados)}
              hint={`pedidos creados ${periodoHint}`}
              tone="blue"
            />
            <CierreTile
              icon={Truck}
              label="Entregados"
              value={fmtInt(cierre.entregados)}
              hint={`entregas completadas ${periodoHint}`}
              tone="emerald"
            />
            <CierreTile
              icon={Gauge}
              label="Cumplimiento"
              value={fmtPct(cierre.cumplimiento)}
              hint="cargado / pedido"
              tone={
                cierre.entregados === 0
                  ? "muted"
                  : cierre.cumplimiento >= 95
                    ? "emerald"
                    : cierre.cumplimiento >= 80
                      ? "amber"
                      : "red"
              }
            />
            <CierreTile
              icon={DollarSign}
              label="Facturación"
              value={fmtCOP(cierre.facturacion)}
              hint={`total entregado ${periodoHint}`}
              tone="violet"
            />
          </div>

          {/* Lista de pedidos entregados en el periodo */}
          <div>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pedidos entregados {periodoHint}
              </h4>
              {cierre.entregadosLista.length > 0 ? (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {fmtInt(cierre.entregadosLista.length)} en total
                </span>
              ) : null}
            </div>
            {cierre.entregadosLista.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-8 px-4 gap-1 rounded-md border border-dashed border-border/60 bg-muted/30">
                <Truck
                  className="h-5 w-5 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-sm font-medium text-foreground">
                  {cierreInfo.live
                    ? "Aún no hay entregas registradas hoy"
                    : "No hay entregas registradas en el periodo"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Las entregas con{" "}
                  <code className="rounded bg-muted px-1">fechadeentrega</code>{" "}
                  {cierreInfo.live
                    ? "igual a hoy aparecerán aquí."
                    : "dentro del periodo seleccionado aparecerán aquí."}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5 max-h-[280px] overflow-y-auto pr-1">
                {cierre.entregadosLista.map((p) => {
                  const tone =
                    p.cumplimientoPct >= 95
                      ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                      : p.cumplimientoPct >= 80
                        ? "text-amber-700 bg-amber-50 border-amber-200"
                        : "text-red-700 bg-red-50 border-red-200"
                  return (
                    <li
                      key={p.idpedido}
                      className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/20 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-sm font-semibold leading-tight truncate"
                            title={p.cliente}
                          >
                            {truncCliente(p.cliente)}
                          </span>
                          <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
                            #{p.pedido}
                          </span>
                          {p.factura ? (
                            <span className="text-[10px] font-medium text-muted-foreground">
                              · Fact. {p.factura}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {fmtInt(p.unidadesCargadas)} / {fmtInt(p.unidadesPedidas)} und
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-md border ${tone}`}
                      >
                        {fmtPct(p.cumplimientoPct)}
                      </span>
                      <span className="text-sm font-bold tabular-nums shrink-0">
                        {fmtCOP(p.total)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Fila 3: Tres rankings ejecutivos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Top destinos */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 5 Destinos</CardTitle>
            <p className="text-xs text-muted-foreground">
              Frecuencia de despachos por <code className="rounded bg-muted px-1">destino</code>.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            {topDestinos.length === 0 ? (
              <EmptyState text="Sin destinos registrados." />
            ) : (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topDestinos}
                    layout="vertical"
                    margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                    barSize={16}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="destino"
                      stroke="var(--muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={110}
                      tickFormatter={(s: string) =>
                        s.length > 16 ? `${s.slice(0, 15)}…` : s
                      }
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)" }}
                      contentStyle={{
                        backgroundColor: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--popover-foreground)",
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [
                        `${fmtInt(value)} despachos`,
                        "Total",
                      ]}
                    />
                    <Bar
                      dataKey="despachos"
                      fill="var(--chart-2)"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top vendedores */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 5 Vendedores</CardTitle>
            <p className="text-xs text-muted-foreground">
              Por monto facturado.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {topVendedores.length === 0 ? (
              <EmptyState text="Sin vendedores registrados." />
            ) : (
              <ul className="flex flex-col gap-2">
                {topVendedores.map((v, idx) => (
                  <RankingRow
                    key={v.vendedor}
                    rank={idx + 1}
                    title={v.vendedor}
                    subtitle={`${fmtInt(v.pedidos)} pedidos`}
                    value={fmtCOP(v.ventas)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Top clientes */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top 5 Clientes</CardTitle>
            <p className="text-xs text-muted-foreground">
              Por monto facturado.
            </p>
          </CardHeader>
          <CardContent className="pt-2">
            {topClientes.length === 0 ? (
              <EmptyState text="Sin clientes registrados." />
            ) : (
              <ul className="flex flex-col gap-2">
                {topClientes.map((c, idx) => (
                  <RankingRow
                    key={c.cliente}
                    rank={idx + 1}
                    title={truncCliente(c.cliente)}
                    subtitle={`${fmtInt(c.pedidos)} pedidos`}
                    value={fmtCOP(c.ventas)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/**
 * Footer pequeño para los KpiCard que muestra un breakdown horizontal
 * (ej. "A tiempo 23 / Tarde 5"). Usa colores de los chart tokens.
 */
function KpiBreakdown({
  items,
  total,
}: {
  items: Array<{ label: string; value: number; tone: "success" | "danger" }>
  total: number
}) {
  if (total <= 0) {
    return (
      <p className="text-[10px] text-muted-foreground">
        Sin pedidos evaluables
      </p>
    )
  }
  return (
    <div className="flex items-center gap-3 text-[10px] tabular-nums">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              it.tone === "success"
                ? "bg-[var(--chart-3)]"
                : "bg-destructive"
            }`}
          />
          <span className="text-muted-foreground">{it.label}</span>
          <span className="font-semibold text-foreground">
            {fmtInt(it.value)}
          </span>
        </span>
      ))}
      <span className="ml-auto text-muted-foreground">
        / {fmtInt(total)}
      </span>
    </div>
  )
}

/**
 * Fila de ranking estandarizada (numero, titulo, subtitulo, valor).
 * Usada en las tarjetas Top Vendedores / Top Clientes para mantener
 * una grilla visual consistente sin reinventar el componente.
 */
function RankingRow({
  rank,
  title,
  subtitle,
  value,
}: {
  rank: number
  title: string
  subtitle: string
  value: string
}) {
  return (
    <li className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 px-3 py-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-medium leading-tight truncate"
          title={title}
        >
          {title}
        </p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <span className="text-sm font-bold tabular-nums shrink-0">
        {value}
      </span>
    </li>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground text-center px-4">
      {text}
    </div>
  )
}

/**
 * Tile compacto del bloque "Cierre del Día". Comparte estructura con
 * los KPI cards (icono pill + label + valor + hint) pero con paddings
 * mas cerrados para que las 4 tarjetas quepan en una sola fila en
 * desktop sin sentirse apretadas.
 *
 * `tone` controla solo la paleta del icono y del valor; el resto del
 * tile mantiene la estetica neutra del theme (border-border/60, muted)
 * para no competir visualmente con los KPIs principales de arriba.
 */
function CierreTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof CheckCircle2
  label: string
  value: string
  hint: string
  tone: "blue" | "emerald" | "amber" | "red" | "violet" | "muted"
}) {
  const tones: Record<
    typeof tone,
    { iconBg: string; iconColor: string; valueColor: string }
  > = {
    blue: {
      iconBg: "bg-blue-100",
      iconColor: "text-blue-600",
      valueColor: "text-foreground",
    },
    emerald: {
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      valueColor: "text-foreground",
    },
    amber: {
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      valueColor: "text-amber-700",
    },
    red: {
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      valueColor: "text-red-700",
    },
    violet: {
      iconBg: "bg-violet-100",
      iconColor: "text-violet-600",
      valueColor: "text-foreground",
    },
    muted: {
      iconBg: "bg-muted",
      iconColor: "text-muted-foreground",
      valueColor: "text-muted-foreground",
    },
  }
  const t = tones[tone]
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className={`${t.iconBg} p-1.5 rounded-md`}>
          <Icon className={`h-3.5 w-3.5 ${t.iconColor}`} aria-hidden />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <span
        className={`lg-num text-2xl font-bold leading-none ${t.valueColor}`}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground leading-tight">
        {hint}
      </span>
    </div>
  )
}
