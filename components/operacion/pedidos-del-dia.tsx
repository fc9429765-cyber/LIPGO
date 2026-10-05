"use client"

// PEDIDOS DEL DÍA — la línea llamativa "Vencen hoy: N pedidos · X t" arriba del módulo y, al
// tocarla, el panel lateral con lo que LIPgo preparó (lo que falta por cargar, atrasados
// recientes, mañana). Gerencia (2026-10-05): "de manera llamativa y, si quieren ver lo que
// preparó la IA, ingresan, para no saturar los módulos". Lo ve quien tiene el permiso de
// "Generar Órdenes de Cargue": la compuerta está en la acción (getPedidosDelDia); si no hay
// permiso, o no hay nada pendiente, este componente no ocupa ni un píxel.
//
// Se monta en Centro de Coordinación (donde se ejecuta) y en Generar Órdenes de Cargue.
// Reglas de presentación en lib/pedidos-del-dia.ts (puro, probado).

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, ArrowRight, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow, Progreso, Seccion, type Tono } from "@/components/ui/lipgo"
import { cn } from "@/lib/utils"
import { getPedidosDelDia } from "@/lib/pedidos-cola-actions"
import { formatoPeso, hayQueMostrar, pctAvance, plural, resumenVencen, textoVencen, tonoVencen, type PedidoDelDia, type PedidosDelDia } from "@/lib/pedidos-del-dia"
import { irAModulo } from "@/components/orders/gestionar/formato"

const LINEA: Record<Tono, string> = {
  critico: "border-critico-bd bg-critico-bg text-critico-fg hover:bg-critico-bg/80",
  atencion: "border-atencion-bd bg-atencion-bg text-atencion-fg hover:bg-atencion-bg/80",
  ok: "border-ok-bd bg-ok-bg text-ok-fg hover:bg-ok-bg/80",
  info: "border-info-bd bg-info-bg text-info-fg",
  neutro: "border-border bg-muted text-foreground",
}

const N0 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 })

function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function PedidosDelDia({ empresaId, className }: { empresaId: number | null | undefined; className?: string }) {
  const [data, setData] = useState<PedidosDelDia | null>(null)
  const [cargando, setCargando] = useState(false)
  const [abierto, setAbierto] = useState(false)
  // Sin permiso (o sin acceso al proyecto) la línea no existe: no se avisa ni se explica.
  const [oculto, setOculto] = useState(false)

  const cargar = useCallback(async () => {
    if (!empresaId) return
    setCargando(true)
    try {
      const r = await getPedidosDelDia(empresaId)
      if (r.success) {
        setData(r.data)
        setOculto(false)
      } else {
        setData(null)
        setOculto(true)
      }
    } finally {
      setCargando(false)
    }
  }, [empresaId])

  useEffect(() => {
    setData(null)
    setOculto(false)
    void cargar()
  }, [cargar])

  if (!empresaId || oculto || !data) return null
  const r = resumenVencen(data)
  if (!hayQueMostrar(r)) return null
  const tono = tonoVencen(r)
  const avance = pctAvance(data)

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={cn("flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors", LINEA[tono], className)}
        aria-haspopup="dialog"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span className="lg-num min-w-0 flex-1 truncate">{textoVencen(r)}</span>
        <span className="hidden shrink-0 items-center gap-1 text-xs font-semibold sm:inline-flex">
          Ver lo que preparó LIPgo
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>

      <Sheet open={abierto} onOpenChange={setAbierto}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader className="text-left">
            <Eyebrow>Pedidos del día · {fechaCorta(data.hoy)}</Eyebrow>
            <SheetTitle>Lo que hay que cargar hoy</SheetTitle>
            <SheetDescription>
              Por fecha de entrega prometida. La demanda de hoy es la meta del día; lo que falta por cargar es lo que queda de ella. Sin precios ni condiciones comerciales.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-4">
            <section className="lg-card grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-4" aria-label="Demanda del día">
              <Cifra tamano="compacta" label="Demanda de hoy" valor={formatoPeso(data.demandaHoy.kg)} sub={`${plural(data.demandaHoy.pedidos, "pedido prometido", "pedidos prometidos")} · ${N0.format(data.demandaHoy.registradosHoy)} registrados hoy`} />
              <Cifra tamano="compacta" label="Ya salió" valor={formatoPeso(data.salieronHoy.kg)} tono="ok" sub={`${plural(data.salieronHoy.pedidos, "pedido con orden", "pedidos con orden")}${avance != null ? ` · ${avance} %` : ""}`} />
              <Cifra tamano="compacta" label="Falta por cargar" valor={formatoPeso(data.vencenHoy.kg)} tono={data.vencenHoy.pedidos > 0 ? "atencion" : "ok"} sub={`${plural(data.vencenHoy.pedidos, "pedido sin orden", "pedidos sin orden")}${data.vencenHoy.porAprobar > 0 ? ` · ${data.vencenHoy.porAprobar} por aprobar` : ""}`} />
              <Cifra tamano="compacta" label="Atrasados sin orden" valor={formatoPeso(data.atrasados.kg)} tono={data.atrasados.pedidos > 0 ? "critico" : "ok"} sub={`${plural(data.atrasados.pedidos, "pedido con promesa vencida", "pedidos con promesa vencida")}`} />
            </section>

            {avance != null && (
              <div className="lg-card flex flex-col gap-2 p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Avance del día contra la demanda de pedidos</span>
                  <span className="lg-num">{formatoPeso(data.salieronHoy.kg)} de {formatoPeso(data.demandaHoy.kg)}{data.metaAcuerdoT > 0 ? ` · meta del acuerdo ${data.metaAcuerdoT.toLocaleString("es-CO", { maximumFractionDigits: 1 })} t/día` : ""}</span>
                </div>
                <Progreso pct={avance} tono={avance >= 100 ? "ok" : avance >= 60 ? "info" : "atencion"} />
              </div>
            )}

            <Seccion eyebrow="Vencen hoy" titulo={data.vencenHoy.pedidos > 0 ? `${plural(data.vencenHoy.pedidos, "pedido sin orden de cargue", "pedidos sin orden de cargue")}` : "Nada pendiente para hoy"} sinPadding
              accion={
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => irAModulo("Generar Órdenes de Cargue")}>
                  Generar órdenes <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            >
              {data.vencenHoy.lista.length === 0 ? (
                <div className="p-4"><EstadoVacio titulo="Todo lo prometido para hoy ya tiene orden de cargue" /></div>
              ) : (
                <ul className="divide-y divide-border">
                  {data.vencenHoy.lista.map((p) => <FilaPedido key={p.idpedido} p={p} />)}
                </ul>
              )}
            </Seccion>

            {data.atrasados.recientes.length > 0 && (
              <Seccion eyebrow="Atrasados de los últimos días" titulo={`${plural(data.atrasados.recientes.length, "pedido", "pedidos")} con promesa vencida y sin orden`} sinPadding
                accion={
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => irAModulo("Gestionar pedidos")}>
                    Ver los {N0.format(data.atrasados.pedidos)} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                }
              >
                <ul className="divide-y divide-border">
                  {data.atrasados.recientes.map((p) => <FilaPedido key={p.idpedido} p={p} mostrarPromesa />)}
                </ul>
                {data.atrasados.pedidos > data.atrasados.recientes.length && (
                  <p className="px-4 py-3 text-xs text-muted-foreground">
                    {N0.format(data.atrasados.pedidos - data.atrasados.recientes.length)} más antiguos ({formatoPeso(data.atrasados.kg - data.atrasados.recientes.reduce((s, p) => s + p.kg, 0))}). Si no van a salir, se depuran desde Gestionar pedidos para que dejen de contar como atraso.
                  </p>
                )}
              </Seccion>
            )}

            <Seccion eyebrow={`Mañana · ${fechaCorta(data.manana)}`} titulo={data.paraManana.pedidos > 0 ? `${plural(data.paraManana.pedidos, "pedido", "pedidos")} · ${formatoPeso(data.paraManana.kg)} sin orden` : "Sin pedidos prometidos para mañana todavía"} sinPadding>
              {data.paraManana.lista.length > 0 && (
                <ul className="divide-y divide-border">
                  {data.paraManana.lista.map((p) => <FilaPedido key={p.idpedido} p={p} />)}
                </ul>
              )}
              {(data.paraManana.salieron.pedidos > 0 || data.paraManana.porAprobar > 0) && (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  {data.paraManana.salieron.pedidos > 0 ? `${plural(data.paraManana.salieron.pedidos, "pedido de mañana ya salió", "pedidos de mañana ya salieron")} por adelantado (${formatoPeso(data.paraManana.salieron.kg)}). ` : ""}
                  {data.paraManana.porAprobar > 0 ? `${plural(data.paraManana.porAprobar, "pedido", "pedidos")} por aprobar. ` : ""}
                  Con lo que falta se programa el personal de mañana.
                </p>
              )}
            </Seccion>

            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Visible para quien tiene permiso de Generar Órdenes de Cargue.</p>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={cargar} disabled={cargando}>
                <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
              </Button>
            </div>
            {cargando && <Esqueleto lineas={2} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

function FilaPedido({ p, mostrarPromesa = false }: { p: PedidoDelDia; mostrarPromesa?: boolean }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="lg-num text-sm font-semibold">#{p.idpedido}</span>
          <span className="truncate text-sm font-medium">{p.cliente}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {[p.tipoDespacho?.toLowerCase(), plural(p.lineas, "línea", "líneas"), mostrarPromesa && p.fechaProgramada ? `promesa ${fechaCorta(p.fechaProgramada)} · hace ${plural(p.atrasoDias, "día", "días")}` : `registrado ${fechaCorta(p.registrado)}`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="text-right">
        <div className="lg-num text-sm font-semibold">{formatoPeso(p.kg)}</div>
        <div className="lg-num text-xs text-muted-foreground">{N0.format(p.unidades)} und</div>
      </div>
      {p.aprobado ? <Chip tono="ok">Aprobado</Chip> : <Chip tono="atencion">{p.carteraLista ? "Por aprobar · cartera lista" : "Por aprobar"}</Chip>}
    </li>
  )
}
