"use client"

// Pestaña "Para mañana": demanda de un día (pedidos abiertos con promesa ese día) frente
// a la programación de vehículos del cliente. Solo para el usuario del cliente y
// gerencia: el coordinador LIP no ve pedidos.

import { useEffect, useState } from "react"
import { AlertTriangle, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow, Progreso, Seccion } from "@/components/ui/lipgo"
import { getDemandaFecha, type DemandaFecha } from "@/lib/pedidos-cola-actions"
import { MODULO_PROGRAMACION, NUM, T1, fechaCorta, fechaLarga, horaCorta, irAModulo, tTexto } from "./formato"

export function ParaMananaTab({ empresaId, manana, onVerPedidos }: { empresaId: number | null; manana: string; onVerPedidos: (fecha: string) => void }) {
  const [fecha, setFecha] = useState(manana)
  const [data, setData] = useState<DemandaFecha | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoSalto, setAutoSalto] = useState(false)

  useEffect(() => {
    if (!empresaId) return
    let vivo = true
    setCargando(true)
    getDemandaFecha(empresaId, fecha).then((r) => {
      if (!vivo) return
      if (r.success) {
        setData(r.data)
        setError(null)
        // Si mañana no tiene pedidos, se muestra el siguiente día con demanda (una sola vez).
        if (!autoSalto && fecha === manana && r.data.pedidos === 0) {
          const sig = r.data.proximosDias.find((d) => d.pedidos > 0)
          setAutoSalto(true)
          if (sig) setFecha(sig.fecha)
        }
      } else setError(r.message)
      setCargando(false)
    })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, fecha])

  if (error) return <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-4 text-sm text-atencion-fg">{error}</div>
  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-[7fr_5fr]">
        <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
        <div className="lg-card p-5"><Esqueleto lineas={5} /></div>
      </div>
    )
  }

  const d = data
  const cobertura = d.programacion.tiene && d.programacion.capacidadT != null && d.kg > 0 ? Math.round(((d.programacion.capacidadT * 1000) / d.kg) * 100) : null
  const faltanT = d.programacion.tiene && d.programacion.capacidadT != null ? Math.max(0, d.kg / 1000 - d.programacion.capacidadT) : d.kg / 1000
  const refMula = d.tiposVehiculo.find((t) => (t.capacidad ?? 0) >= 30)
  const refDoble = d.tiposVehiculo.find((t) => t.capacidad != null && t.capacidad >= 14 && t.capacidad < 30)

  return (
    <div className="flex flex-col gap-4" aria-busy={cargando}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Día</span>
        {d.proximosDias.map((p) => (
          <button
            key={p.fecha}
            type="button"
            onClick={() => setFecha(p.fecha)}
            className={`flex h-12 flex-col items-center justify-center rounded-xl border px-3 text-xs leading-tight transition-colors ${fecha === p.fecha ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}
          >
            <span className="font-semibold">{fechaCorta(p.fecha)}{p.fecha === manana ? " · mañana" : ""}</span>
            <span className={`lg-num ${fecha === p.fecha ? "opacity-80" : "text-muted-foreground"}`}>{p.pedidos === 0 ? "sin pedidos" : `${p.pedidos} · ${tTexto(p.kg)}`}</span>
          </button>
        ))}
        {fecha !== manana && autoSalto && <span className="text-xs text-muted-foreground">Mañana no tiene pedidos; se muestra el siguiente día con demanda.</span>}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[7fr_5fr]">
        <div className="flex flex-col gap-4">
          <Seccion eyebrow="Demanda del día" titulo={`Pedidos para el ${fechaLarga(d.fecha)}`} accion={<Chip tono="neutro">Promesa = fecha programada del pedido</Chip>} sinPadding>
            {d.pedidos === 0 ? (
              <EstadoVacio titulo="Sin pedidos para este día" texto="Cuando se registre un pedido con esta fecha prometida aparecerá aquí con sus kilos." />
            ) : (
              <>
                <div className="grid gap-5 px-5 py-4 sm:grid-cols-3">
                  <Cifra label="Pedidos" valor={NUM.format(d.pedidos)} unidad={`${d.aprobados} aprobados${d.porAprobar ? ` · ${d.porAprobar} por aprobar` : ""}`} />
                  <Cifra label="Kilos" valor={NUM.format(Math.round(d.kg))} unidad={`kg · ${tTexto(d.kg)}`} />
                  <Cifra label="Unidades" valor={NUM.format(d.unidades)} unidad="bultos y paquetes" />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2 text-left font-semibold">Cliente</th>
                        <th className="px-3 py-2 text-left font-semibold">Despacho</th>
                        <th className="px-3 py-2 text-right font-semibold">Pedidos</th>
                        <th className="px-3 py-2 text-right font-semibold">Kilos</th>
                        <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                        <th className="px-5 py-2 text-left font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.porCliente.map((c) => (
                        <tr key={c.cliente} className="border-t border-border/60">
                          <td className="px-5 py-2.5 font-medium">{c.cliente}</td>
                          <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1">{c.tiposDespacho.map((t) => <Chip key={t} tono="neutro">{t}</Chip>)}</span></td>
                          <td className="lg-num px-3 py-2.5 text-right">{c.pedidos}</td>
                          <td className="lg-num px-3 py-2.5 text-right font-semibold">{NUM.format(Math.round(c.kg))}</td>
                          <td className="lg-num px-3 py-2.5 text-right">{NUM.format(c.unidades)}</td>
                          <td className="px-5 py-2.5">{c.porAprobar > 0 ? <Chip tono="neutro">{c.porAprobar === c.pedidos ? "Por aprobar" : `${c.porAprobar} por aprobar`}</Chip> : <Chip tono="ok">{c.pedidos === 1 ? "Aprobado" : "Aprobados"}</Chip>}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40 font-semibold">
                      <tr>
                        <td className="px-5 py-2.5">Total</td>
                        <td className="px-3 py-2.5 text-xs font-normal text-muted-foreground">{d.porDespacho.map((x) => `${x.tipo} ${x.pedidos}`).join(" · ")}</td>
                        <td className="lg-num px-3 py-2.5 text-right">{d.pedidos}</td>
                        <td className="lg-num px-3 py-2.5 text-right">{NUM.format(Math.round(d.kg))}</td>
                        <td className="lg-num px-3 py-2.5 text-right">{NUM.format(d.unidades)}</td>
                        <td className="px-5 py-2.5"><Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onVerPedidos(d.fecha)}>Ver pedidos en la Cola</Button></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </Seccion>

          <Seccion eyebrow="También podrían salir" titulo="Atrasados de los últimos 15 días" accion={<Chip tono={d.atrasadosRecientes.total > 0 ? "critico" : "ok"}>{d.atrasadosRecientes.total > 0 ? `${d.atrasadosRecientes.total} pedidos · ${tTexto(d.atrasadosRecientes.kg)}` : "Ninguno"}</Chip>} sinPadding>
            {d.atrasadosRecientes.total === 0 ? (
              <EstadoVacio titulo="No hay atrasados recientes" texto="Ningún pedido aprobado de los últimos 15 días está sin orden de cargue." />
            ) : (
              <ul className="divide-y divide-border">
                {d.atrasadosRecientes.porCliente.map((c) => (
                  <li key={c.cliente} className="flex items-center gap-3.5 px-5 py-3">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-red-700 shadow-[0_0_0_4px_#FEE2E2]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{c.cliente} · {c.pedidos} {c.pedidos === 1 ? "pedido" : "pedidos"} · <span className="lg-num">{NUM.format(Math.round(c.kg))}</span> kg</p>
                      <p className="lg-num text-xs text-muted-foreground">Promesa {c.promesas.sort().map(fechaCorta).join(", ")}</p>
                    </div>
                  </li>
                ))}
                <li className="px-5 py-3 text-xs text-muted-foreground">
                  Si se van a despachar junto con lo de este día, deben sumarse a la programación de vehículos. Los atrasados de más de 15 días no se cuentan aquí: están en Depurar pendientes.
                </li>
              </ul>
            )}
          </Seccion>
        </div>

        <div className="flex flex-col gap-4">
          <Seccion
            eyebrow="Programación de mañana"
            titulo={`Vehículos para el ${fechaCorta(d.fecha)}`}
            accion={
              d.programacion.tiene ? (
                <Chip tono={cobertura != null && cobertura >= 100 ? "ok" : "atencion"}>{d.programacion.vehiculos} vehículos{d.programacion.aTiempo === false ? " · enviada tarde" : ""}</Chip>
              ) : (
                <Chip tono="atencion"><AlertTriangle className="h-3 w-3" /> Sin programación</Chip>
              )
            }
          >
            <div className="flex flex-col gap-4">
              {!d.programacion.tiene ? (
                <p className="text-sm leading-relaxed">
                  {d.programacion.usa ? "El cliente aún no ha registrado la programación de vehículos de este día." : "Este proyecto no ha registrado programación de vehículos todavía."} La hora límite es las <b className="font-semibold">5:00 p. m. de la víspera</b>.
                </p>
              ) : (
                <p className="lg-num text-sm">
                  {d.programacion.porTipo.map((t) => `${t.cantidad} ${t.tipo}${t.capacidadT != null ? ` (${T1.format(t.capacidadT)} t)` : ""}`).join(" · ")}
                  {d.programacion.enviadaEn ? ` · enviada ${horaCorta(d.programacion.enviadaEn)}` : ""}
                </p>
              )}
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Demanda</span><span className="lg-num font-semibold">{tTexto(d.kg)}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Capacidad programada</span>
                  <span className="lg-num font-semibold">{d.programacion.tiene ? (d.programacion.capacidadT != null ? `${T1.format(d.programacion.capacidadT)} t · ${d.programacion.vehiculos} vehículos` : `${d.programacion.vehiculos} vehículos · tipo sin capacidad`) : "0 t · 0 vehículos"}</span>
                </div>
                <Progreso pct={cobertura ?? 0} tono={cobertura != null && cobertura >= 100 ? "ok" : "atencion"} />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Cobertura</span>
                  <span className={`lg-num font-semibold ${cobertura != null && cobertura >= 100 ? "text-ok-fg" : "text-atencion-fg"}`}>
                    {d.kg === 0 ? "sin demanda" : cobertura == null ? (d.programacion.tiene ? "sin capacidad por tipo" : `0 % · faltan ${T1.format(faltanT)} t`) : cobertura >= 100 ? `${cobertura} % · cubre` : `${cobertura} % · faltan ${T1.format(faltanT)} t`}
                  </span>
                </div>
              </div>
              {d.tiposVehiculo.length > 0 && (
                <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-3">
                  <Eyebrow className="text-muted-foreground">Referencia · capacidad por tipo (catálogo)</Eyebrow>
                  <p className="lg-num mt-1.5 text-sm leading-relaxed">{d.tiposVehiculo.map((t) => `${t.nombre} ${t.capacidad != null ? `${T1.format(t.capacidad)} t` : "—"}`).join(" · ")}</p>
                  {d.kg > 0 && (refMula || refDoble) && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {tTexto(d.kg)} equivalen a{refMula && refMula.capacidad ? ` ${Math.ceil(d.kg / 1000 / refMula.capacidad)} ${refMula.nombre.toLowerCase()}${Math.ceil(d.kg / 1000 / refMula.capacidad) === 1 ? "" : "s"}` : ""}
                      {refMula && refDoble ? " o" : ""}
                      {refDoble && refDoble.capacidad ? ` ${Math.ceil(d.kg / 1000 / refDoble.capacidad)} ${refDoble.nombre.toLowerCase()}${Math.ceil(d.kg / 1000 / refDoble.capacidad) === 1 ? "" : "s"}` : ""}.
                    </p>
                  )}
                </div>
              )}
              <Button className="gap-1.5" onClick={() => irAModulo(MODULO_PROGRAMACION)}>
                <Truck className="h-4 w-4" /> {d.programacion.tiene ? "Ver o ajustar la programación" : "Registrar programación de mañana"}
              </Button>
            </div>
          </Seccion>

          <Seccion eyebrow="Cómo se cruza" titulo="Pedidos ↔ Programación">
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
              <li><b className="font-semibold">Demanda</b> = pedidos abiertos con promesa ese día; kilos y unidades salen de las líneas del pedido.</li>
              <li><b className="font-semibold">Cobertura</b> = vehículos programados × capacidad del tipo, frente a la demanda.</li>
              <li>Lo que llegue después del corte entra como <b className="font-semibold">versión nueva</b> de la programación; el cumplimiento se mide contra la versión vigente al corte.</li>
            </ul>
          </Seccion>
        </div>
      </div>
    </div>
  )
}
