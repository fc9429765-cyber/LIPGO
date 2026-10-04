"use client"

// Bloques del Dashboard de pedidos. Cada bloque responde a una pregunta del gerente y
// termina en una acción (botón a Gestionar). Sin tortas ni dobles ejes: barras simples
// con el número al lado, tokens del sistema visual LIPgo.

import { ArrowRight, Eraser } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip, EstadoVacio, Eyebrow, Progreso, Seccion } from "@/components/ui/lipgo"
import type { DashboardPedidosPeriodo } from "@/lib/dashboard-pedidos-periodo-actions"
import { etiquetaMes } from "@/lib/periodo-rango"
import { NUM, T1, abrirGestionar, fechaCorta, tTexto } from "@/components/orders/gestionar/formato"

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)
const pctTexto = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—")
const tonoPct = (p: number | null): "ok" | "atencion" | "critico" | "neutro" => (p == null ? "neutro" : p >= 90 ? "ok" : p >= 75 ? "atencion" : "critico")

/** Barra horizontal simple: largo proporcional a `max`. */
export function Barra({ valor, max, tono = "acento", className }: { valor: number; max: number; tono?: "acento" | "amber" | "rojo" | "marca" | "slate"; className?: string }) {
  const w = max > 0 ? Math.max(valor > 0 ? 2 : 0, Math.round((valor / max) * 100)) : 0
  const color = tono === "amber" ? "bg-amber-600" : tono === "rojo" ? "bg-red-700" : tono === "marca" ? "bg-marca" : tono === "slate" ? "bg-slate-400" : "bg-acento"
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-muted ${className ?? ""}`} aria-hidden>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  )
}

const SEG = { aTiempo: "bg-acento", tarde: "bg-amber-600", pendiente: "bg-slate-300 text-slate-800", noEntregado: "bg-slate-500", anulado: "bg-slate-400", cerradoSinFecha: "bg-teal-300 text-teal-950" } as const

function Apilada({ s, max }: { s: DashboardPedidosPeriodo["semanas"][number]; max: number }) {
  const total = s.aTiempo + s.tarde + s.pendiente + s.noEntregado + s.anulado + s.cerradoSinFecha
  const partes: [keyof typeof SEG, number][] = [
    ["aTiempo", s.aTiempo],
    ["tarde", s.tarde],
    ["pendiente", s.pendiente],
    ["cerradoSinFecha", s.cerradoSinFecha],
    ["noEntregado", s.noEntregado],
    ["anulado", s.anulado],
  ]
  return (
    <div className="flex h-6 overflow-hidden rounded-md bg-muted" style={{ width: `${max > 0 ? Math.max(8, Math.round((total / max) * 100)) : 0}%` }} role="img" aria-label={`${total} pedidos`}>
      {partes.filter(([, n]) => n > 0).map(([k, n]) => (
        <span key={k} className={`flex items-center justify-center text-[11px] font-semibold text-white ${SEG[k]}`} style={{ flex: n }} title={`${k}: ${n}`}>
          {n >= Math.max(2, total * 0.08) ? n : ""}
        </span>
      ))}
    </div>
  )
}

export function BloqueCumplimiento({ d }: { d: DashboardPedidosPeriodo }) {
  const maxSem = Math.max(1, ...d.semanas.map((s) => s.aTiempo + s.tarde + s.pendiente + s.noEntregado + s.anulado + s.cerradoSinFecha))
  const f = d.franja
  return (
    <Seccion
      eyebrow="Cumplimiento"
      titulo="¿Se cargó el día de la promesa?"
      accion={
        <div className="hidden flex-wrap gap-3 text-xs text-muted-foreground sm:flex">
          {([["aTiempo", "A tiempo"], ["tarde", "Tarde"], ["pendiente", "Pendiente"], ["cerradoSinFecha", "Cerrado sin fecha"], ["noEntregado", "No entregado"], ["anulado", "Anulado"]] as [keyof typeof SEG, string][]).map(([k, t]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><i className={`inline-block h-2.5 w-2.5 rounded-sm ${SEG[k].split(" ")[0]}`} />{t}</span>
          ))}
        </div>
      }
      sinPadding
    >
      {d.semanas.length === 0 ? (
        <EstadoVacio titulo="Sin pedidos prometidos en este período" texto="Cambia el período o revisa que existan pedidos con fecha programada." />
      ) : (
        <>
          <ul className="divide-y divide-border">
            {d.semanas.map((s) => {
              const conFecha = s.aTiempo + s.tarde
              return (
                <li key={s.inicio} className="grid grid-cols-1 items-center gap-2 px-5 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_170px] sm:gap-4">
                  <div>
                    <p className="text-sm font-semibold leading-tight">Semana del {fechaCorta(s.inicio)}</p>
                    <p className="lg-num text-xs text-muted-foreground">{NUM.format(s.aTiempo + s.tarde + s.pendiente + s.noEntregado + s.anulado + s.cerradoSinFecha)} pedidos · {tTexto(s.kg)}</p>
                  </div>
                  <Apilada s={s} max={maxSem} />
                  <p className="lg-num text-xs text-muted-foreground sm:text-right">
                    a tiempo <b className={`font-semibold ${tonoPct(pct(s.aTiempo, conFecha)) === "critico" ? "text-critico-fg" : tonoPct(pct(s.aTiempo, conFecha)) === "atencion" ? "text-atencion-fg" : "text-foreground"}`}>{pctTexto(s.aTiempo, conFecha)}</b> · cargado {tTexto(s.kgCargados)}
                  </p>
                </li>
              )
            })}
          </ul>

          <div className="border-t border-border px-5 py-4">
            <Eyebrow className="text-muted-foreground">Tendencia · últimos 6 meses</Eyebrow>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {d.meses.map((m) => {
                const p = pct(m.aTiempo, m.conFecha)
                return (
                  <div key={m.mes} className="flex flex-col gap-1">
                    <span className={`lg-num text-xl font-bold leading-none ${p == null ? "text-muted-foreground" : tonoPct(p) === "critico" ? "text-critico-fg" : tonoPct(p) === "atencion" ? "text-atencion-fg" : "text-ok-fg"}`}>{p == null ? "—" : `${p} %`}</span>
                    <Barra valor={p ?? 0} max={100} tono={p == null ? "slate" : tonoPct(p) === "critico" ? "rojo" : tonoPct(p) === "atencion" ? "amber" : "acento"} />
                    <span className="text-xs font-medium capitalize">{etiquetaMes(m.mes)}</span>
                    <span className="lg-num text-[11px] text-muted-foreground">{NUM.format(m.pedidos)} pedidos{m.pendientes ? ` · ${m.pendientes} pend.` : ""}</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid border-t border-border lg:grid-cols-2">
            <div className="border-b border-border lg:border-b-0 lg:border-r">
              <div className="px-5 pt-4 pb-2"><Eyebrow className="text-muted-foreground">Por tipo de despacho</Eyebrow></div>
              <table className="w-full text-sm">
                <tbody>
                  {d.porDespacho.map((x) => (
                    <tr key={x.tipo} className="border-t border-border/60">
                      <td className="px-5 py-2 font-medium">{x.tipo}<span className="lg-num block text-xs font-normal text-muted-foreground">{NUM.format(x.pedidos)} pedidos · {tTexto(x.kg)}{x.pendientes ? ` · ${x.pendientes} pendientes` : ""}</span></td>
                      <td className="w-[140px] px-3 py-2"><Barra valor={x.aTiempo} max={x.conFecha} tono={tonoPct(pct(x.aTiempo, x.conFecha)) === "ok" ? "acento" : tonoPct(pct(x.aTiempo, x.conFecha)) === "atencion" ? "amber" : "rojo"} /></td>
                      <td className="lg-num px-5 py-2 text-right font-semibold">{pctTexto(x.aTiempo, x.conFecha)}<span className="block text-[11px] font-normal text-muted-foreground">{x.aTiempo} de {x.conFecha}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="px-5 pt-4 pb-2"><Eyebrow className="text-muted-foreground">Por cliente · los 10 con más pedidos</Eyebrow></div>
              <table className="w-full text-sm">
                <tbody>
                  {d.porCliente.map((x) => (
                    <tr key={x.cliente} className="border-t border-border/60">
                      <td className="max-w-[220px] px-5 py-2"><span className="block truncate font-medium" title={x.cliente}>{x.cliente}</span><span className="lg-num block text-xs text-muted-foreground">{NUM.format(x.pedidos)} pedidos · {tTexto(x.kg)}{x.tarde ? ` · ${x.tarde} tarde` : ""}{x.pendientes ? ` · ${x.pendientes} pend.` : ""}</span></td>
                      <td className="w-[120px] px-3 py-2"><Barra valor={x.aTiempo} max={x.conFecha} tono={tonoPct(pct(x.aTiempo, x.conFecha)) === "ok" ? "acento" : tonoPct(pct(x.aTiempo, x.conFecha)) === "atencion" ? "amber" : "rojo"} /></td>
                      <td className="lg-num px-5 py-2 text-right font-semibold">{pctTexto(x.aTiempo, x.conFecha)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
            A tiempo = la orden de cargue (o la entrega, si no hubo OC) se dio el día de la promesa o antes. El % se calcula sobre los pedidos que ya tienen fecha de cargue: {NUM.format(f.conFecha)} de {NUM.format(f.pedidos)} en el período.
          </p>
        </>
      )}
    </Seccion>
  )
}

export function BloqueAtraso({ d }: { d: DashboardPedidosPeriodo }) {
  const a = d.atraso
  const maxB = Math.max(1, ...a.buckets.map((b) => b.pedidos))
  return (
    <Seccion eyebrow="Cuando se incumple" titulo="¿De cuánto es el atraso?" accion={<Chip tono={d.franja.tarde > 0 ? "atencion" : "ok"}>{d.franja.tarde > 0 ? `${NUM.format(d.franja.tarde)} tarde` : "Nada tarde"}</Chip>}>
      {d.franja.tarde === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún pedido del período cargó después de su promesa.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <div><Eyebrow className="text-muted-foreground">Promedio</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{a.promedio ?? "—"}<span className="ml-1 text-sm font-normal text-muted-foreground">días</span></p></div>
            <div><Eyebrow className="text-muted-foreground">Mediana</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{a.mediana ?? "—"}<span className="ml-1 text-sm font-normal text-muted-foreground">días</span></p></div>
            <div><Eyebrow className="text-muted-foreground">Máximo</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{a.maximo}<span className="ml-1 text-sm font-normal text-muted-foreground">días</span></p></div>
          </div>
          <ul className="flex flex-col gap-2">
            {a.buckets.map((b) => (
              <li key={b.rango} className="grid grid-cols-[90px_minmax(0,1fr)_60px] items-center gap-3 text-sm">
                <span className="lg-num text-muted-foreground">{b.rango}</span>
                <Barra valor={b.pedidos} max={maxB} tono={b.rango.startsWith("más") ? "rojo" : "amber"} />
                <span className="lg-num text-right font-semibold">{NUM.format(b.pedidos)}</span>
              </li>
            ))}
          </ul>
          {a.pendientesPromedio != null && <p className="text-xs text-muted-foreground">Los {NUM.format(d.franja.pendientes)} pendientes del período llevan en promedio <b className="lg-num font-semibold text-foreground">{a.pendientesPromedio} días</b> desde su promesa.</p>}
        </div>
      )}
    </Seccion>
  )
}

export function BloqueCompletitud({ d }: { d: DashboardPedidosPeriodo }) {
  const c = d.completitud
  const total = c.completos + c.parciales + c.sinDato
  const maxP = Math.max(1, ...c.productosPendientes.map((p) => p.unidades))
  return (
    <Seccion eyebrow="Completitud" titulo="¿Se entrega completo o en partes?" accion={total > 0 ? <Chip tono={pct(c.completos, c.completos + c.parciales) != null && pct(c.completos, c.completos + c.parciales)! >= 90 ? "ok" : "atencion"}>{pctTexto(c.completos, c.completos + c.parciales)} completos</Chip> : undefined} sinPadding>
      {total === 0 ? (
        <EstadoVacio titulo="Aún no hay entregas en el período" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 px-5 py-4">
            <div><Eyebrow className="text-muted-foreground">Completos</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none text-ok-fg">{NUM.format(c.completos)}</p></div>
            <div><Eyebrow className="text-muted-foreground">Parciales</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none text-atencion-fg">{NUM.format(c.parciales)}</p></div>
            <div><Eyebrow className="text-muted-foreground">Sin dato de cargue</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none text-muted-foreground">{NUM.format(c.sinDato)}</p></div>
          </div>
          {c.productosPendientes.length > 0 && (
            <div className="border-t border-border">
              <div className="px-5 pt-3 pb-1"><Eyebrow className="text-muted-foreground">Productos que quedan pendientes en los parciales</Eyebrow></div>
              <ul className="divide-y divide-border/60">
                {c.productosPendientes.map((p) => (
                  <li key={p.producto} className="grid grid-cols-[minmax(0,1fr)_110px_90px] items-center gap-3 px-5 py-2 text-sm">
                    <span className="truncate" title={p.producto}>{p.producto}<span className="lg-num block text-[11px] text-muted-foreground">{p.pedidos} {p.pedidos === 1 ? "pedido" : "pedidos"}</span></span>
                    <Barra valor={p.unidades} max={maxP} tono="amber" />
                    <span className="lg-num text-right font-semibold">{NUM.format(p.unidades)} <span className="text-xs font-normal text-muted-foreground">und</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">Completo = pedido en estado entregado; parcial = parcial o entrega parcial (misma definición del BSC, IND-PED-03). "Sin dato" = tuvo cargue o cierre pero el estado no lo refleja. Unidades cargadas registradas en {NUM.format(d.franja.conCargado)} de {NUM.format(d.franja.pedidos)} pedidos.</p>
        </>
      )}
    </Seccion>
  )
}

export function BloqueVolumen({ d }: { d: DashboardPedidosPeriodo }) {
  const v = d.volumen
  const maxKg = Math.max(1, ...v.porDiaSemana.map((x) => x.kg))
  return (
    <Seccion eyebrow="Volumen y flota" titulo="¿Qué día pesa más y cuánto va por vehículo?" accion={v.diaPico ? <Chip tono="info">pico: {v.diaPico}</Chip> : undefined}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <ul className="flex flex-col gap-1.5">
          {v.porDiaSemana.map((x) => (
            <li key={x.dia} className="grid grid-cols-[36px_minmax(0,1fr)_120px] items-center gap-3 text-sm">
              <span className="font-medium">{x.dia}</span>
              <Barra valor={x.kg} max={maxKg} tono={x.dia === v.diaPico ? "marca" : "acento"} />
              <span className="lg-num text-right text-xs text-muted-foreground"><b className="text-sm font-semibold text-foreground">{tTexto(x.kg)}</b> · {x.pedidos} ped.</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
          <div><Eyebrow className="text-muted-foreground">Órdenes de cargue</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{NUM.format(v.ordenesCargue)}</p></div>
          <div><Eyebrow className="text-muted-foreground">Kilos cargados por orden</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{v.kgPorOrden != null ? tTexto(v.kgPorOrden) : "—"}</p></div>
          <p className="text-xs text-muted-foreground">Kilos prometidos por día de la semana de la promesa. Sirve para programar la flota con Programación de mañana.</p>
        </div>
      </div>
    </Seccion>
  )
}

export function BloqueAnticipacion({ d }: { d: DashboardPedidosPeriodo }) {
  const a = d.anticipacion
  const f = d.franja
  const maxB = Math.max(1, ...a.buckets.map((b) => b.pedidos))
  return (
    <Seccion eyebrow="Anticipación" titulo="¿Con cuánto tiempo llega el pedido?" accion={<Chip tono={pct(f.mismoDia, f.conPromesa) != null && pct(f.mismoDia, f.conPromesa)! > 50 ? "atencion" : "neutro"}>{pctTexto(f.mismoDia, f.conPromesa)} el mismo día</Chip>}>
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {a.buckets.map((b) => (
            <li key={b.rango} className="grid grid-cols-[100px_minmax(0,1fr)_60px] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{b.rango}</span>
              <Barra valor={b.pedidos} max={maxB} tono={b.rango === "mismo día" ? "marca" : "acento"} />
              <span className="lg-num text-right font-semibold">{NUM.format(b.pedidos)}</span>
            </li>
          ))}
        </ul>
        {a.porCliente.length > 0 && (
          <div>
            <Eyebrow className="text-muted-foreground">Clientes que más piden para el mismo día</Eyebrow>
            <ul className="mt-1.5 divide-y divide-border/60 text-sm">
              {a.porCliente.filter((c) => c.mismoDia > 0).slice(0, 5).map((c) => (
                <li key={c.cliente} className="flex items-center justify-between gap-3 py-1.5"><span className="truncate" title={c.cliente}>{c.cliente}</span><span className="lg-num shrink-0 text-xs text-muted-foreground"><b className="text-sm font-semibold text-foreground">{pctTexto(c.mismoDia, c.pedidos)}</b> · {c.mismoDia} de {c.pedidos}</span></li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {a.conHora > 0
            ? `Con hora de registro en ${NUM.format(a.conHora)} pedidos: ${NUM.format(a.despues5pm ?? 0)} del mismo día se registraron después de las 5 p. m.`
            : "La hora de registro se guarda desde el SQL 215; hasta entonces solo se conoce la fecha."}
        </p>
      </div>
    </Seccion>
  )
}

export function BloquePendiente({ d }: { d: DashboardPedidosPeriodo }) {
  const b = d.backlog
  const maxB = Math.max(1, ...b.buckets.map((x) => x.pedidos))
  return (
    <Seccion eyebrow={`Foto de hoy · ${fechaCorta(d.hoy)}`} titulo="Pendiente y atraso" accion={<Chip tono={b.atrasados > 0 ? "critico" : "ok"}>{b.atrasados > 0 ? `${NUM.format(b.atrasados)} atrasados · ${tTexto(b.kgAtrasados)}` : "Sin atrasados"}</Chip>} sinPadding>
      <ul className="divide-y divide-border/60">
        {b.buckets.map((x) => (
          <li key={x.rango} className="grid grid-cols-[90px_minmax(0,1fr)_130px] items-center gap-3 px-5 py-2 text-sm">
            <span className="lg-num text-muted-foreground">{x.rango}</span>
            <Barra valor={x.pedidos} max={maxB} tono={x.rango.startsWith("más") || x.rango.startsWith("16") ? "rojo" : "amber"} />
            <span className="lg-num text-right"><b className="font-semibold">{NUM.format(x.pedidos)}</b> · {tTexto(x.kg)}</span>
          </li>
        ))}
      </ul>
      {b.topClientes.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <Eyebrow className="text-muted-foreground">Clientes con más pedidos atrasados</Eyebrow>
          <ul className="mt-1.5 flex flex-col gap-1 text-sm">
            {b.topClientes.map((c) => (
              <li key={c.cliente} className="flex justify-between gap-3"><span className="truncate" title={c.cliente}>{c.cliente}</span><span className="lg-num shrink-0 text-muted-foreground">{c.pedidos} · {tTexto(c.kg)}</span></li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => abrirGestionar({ tab: "cola", filtro: "atrasados" })}>Ver en la Cola <ArrowRight className="h-3.5 w-3.5" /></Button>
        {b.candidatos > 0 && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => abrirGestionar({ tab: "depurar" })}><Eraser className="h-3.5 w-3.5" /> Depurar pendientes · {NUM.format(b.candidatos)}</Button>
        )}
      </div>
    </Seccion>
  )
}

export function BloqueCierreHoy({ d }: { d: DashboardPedidosPeriodo }) {
  const c = d.cierreHoy
  const falta = c.paraHoy - c.conOc
  return (
    <Seccion eyebrow="Foto de hoy" titulo="Cierre del día" accion={<Chip tono={c.paraHoy === 0 ? "neutro" : falta > 0 ? "atencion" : "ok"}>{c.paraHoy === 0 ? "Sin pedidos para hoy" : falta > 0 ? `Falta${falta === 1 ? "" : "n"} ${falta} orden${falta === 1 ? "" : "es"} de cargue` : "Todo con orden de cargue"}</Chip>}>
      <div className="grid grid-cols-3 gap-3">
        <div><Eyebrow className="text-muted-foreground">Para hoy</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{NUM.format(c.paraHoy)}</p><p className="lg-num mt-1 text-xs text-muted-foreground">{tTexto(c.kgHoy)}</p></div>
        <div><Eyebrow className="text-muted-foreground">Con orden de cargue</Eyebrow><p className={`lg-num mt-1 text-2xl font-bold leading-none ${falta > 0 ? "text-atencion-fg" : ""}`}>{NUM.format(c.conOc)}</p><p className="mt-1 text-xs text-muted-foreground">de {NUM.format(c.paraHoy)}</p></div>
        <div><Eyebrow className="text-muted-foreground">Entregados hoy</Eyebrow><p className="lg-num mt-1 text-2xl font-bold leading-none">{NUM.format(c.entregadosHoy)}</p><p className="mt-1 text-xs text-muted-foreground">con fecha de entrega hoy</p></div>
      </div>
    </Seccion>
  )
}

export function BloqueNoEntregados({ d }: { d: DashboardPedidosPeriodo }) {
  const n = d.noEntregados
  const maxM = Math.max(1, ...n.porMotivo.map((m) => m.pedidos))
  return (
    <Seccion eyebrow="Demanda perdida" titulo="No entregados por motivo" accion={n.disponible ? <Chip tono={n.total > 0 ? "neutro" : "ok"}>{n.total > 0 ? `${NUM.format(n.total)} · ${tTexto(n.kg)}` : "Ninguno en el período"}</Chip> : undefined}>
      {!n.disponible ? (
        <p className="text-sm text-muted-foreground">Se verá al correr el SQL 215.</p>
      ) : n.total === 0 ? (
        <p className="text-sm text-muted-foreground">No se depuró ningún pedido en este período. Los depurados aparecen aquí por motivo y cliente, para devolverle esa información a comercial.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-2">
            {n.porMotivo.map((m) => (
              <li key={m.motivo} className="grid grid-cols-[minmax(0,1fr)_120px_90px] items-center gap-3 text-sm">
                <span className="truncate">{m.motivo}</span>
                <Barra valor={m.pedidos} max={maxM} tono="slate" />
                <span className="lg-num text-right"><b className="font-semibold">{NUM.format(m.pedidos)}</b> · {tTexto(m.kg)}</span>
              </li>
            ))}
          </ul>
          {n.porCliente.length > 0 && (
            <div>
              <Eyebrow className="text-muted-foreground">Clientes</Eyebrow>
              <ul className="mt-1.5 divide-y divide-border/60 text-sm">
                {n.porCliente.map((c) => (
                  <li key={c.cliente} className="flex justify-between gap-3 py-1.5"><span className="truncate" title={c.cliente}>{c.cliente}</span><span className="lg-num shrink-0 text-muted-foreground">{c.pedidos} · {tTexto(c.kg)}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Seccion>
  )
}

export function textoKgCargados(d: DashboardPedidosPeriodo): string {
  const f = d.franja
  return `${T1.format(f.kgCargados / 1000)} t de ${T1.format(f.kg / 1000)} t`
}

export { Progreso }
