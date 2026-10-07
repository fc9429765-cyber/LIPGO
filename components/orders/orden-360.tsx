"use client"

// VISTA 360 DE UNA ORDEN DE CARGUE (gerencia, 2026-10-04): se escribe el número de la orden y
// se ve el ciclo completo — qué pidió la orden, qué lotes se asignaron, qué se despachó de
// verdad y la diferencia si la hay, con el pedido ligado, el vehículo, los tiempos del día y
// quién la cargó. Es información de la operación del CLIENTE; no toca la facturación de LIP
// (que va por peso de báscula).

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, Search, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow, Punto, Seccion, type Tono } from "@/components/ui/lipgo"
import { useAuth } from "@/components/auth-provider"
import { getOrden360, type Linea360, type Orden360 } from "@/lib/orden-360-actions"

const NUM = new Intl.NumberFormat("es-CO")
const T1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })

const TONO_LINEA: Record<Linea360["estado"], Tono> = {
  cuadra: "ok",
  menos: "atencion",
  mas: "critico",
  sin_despachar: "neutro",
}
const TEXTO_LINEA: Record<Linea360["estado"], string> = {
  cuadra: "Cuadra",
  menos: "Salió menos",
  mas: "Salió de más",
  sin_despachar: "Sin despachar",
}

export function Orden360Dialog({
  ordendecargue,
  open,
  onOpenChange,
}: {
  ordendecargue: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { selectedEmpresaId } = useAuth()
  const [buscado, setBuscado] = useState(ordendecargue ?? "")
  const [data, setData] = useState<Orden360 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const buscar = async (oc: string) => {
    if (!oc.trim()) return
    setCargando(true)
    setError(null)
    const r = await getOrden360(oc.trim(), selectedEmpresaId)
    setCargando(false)
    if (r.success) {
      setData(r.data)
    } else {
      setData(null)
      setError(r.message)
    }
  }

  useEffect(() => {
    if (!open) return
    setBuscado(ordendecargue ?? "")
    setData(null)
    setError(null)
    if (ordendecargue) void buscar(ordendecargue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ordendecargue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Orden de cargue · ciclo completo</DialogTitle>
          <DialogDescription>
            Qué pidió la orden, qué lotes se asignaron y qué se despachó de verdad.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void buscar(buscado)
          }}
        >
          <Input value={buscado} onChange={(e) => setBuscado(e.target.value)} placeholder="Número de la orden, por ejemplo IND202609159189" className="h-9" />
          <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={cargando || !buscado.trim()}>
            {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
          </Button>
        </form>

        {error && <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-3 text-sm text-atencion-fg">{error}</div>}
        {cargando && !data && <Esqueleto lineas={6} />}

        {data && (
          <div className="flex flex-col gap-4">
            {/* Resumen del ciclo */}
            <section className="lg-card px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Eyebrow>{data.tipoOperacion ?? "Orden"} · {data.fecha ?? "sin fecha"}</Eyebrow>
                  <h2 className="lg-num text-lg font-bold leading-tight">{data.ordendecargue}</h2>
                </div>
                {data.resumen.cuadra ? (
                  <Chip tono="ok"><CheckCircle2 className="h-3.5 w-3.5" /> Lo despachado coincide con la orden</Chip>
                ) : (
                  <Chip tono={data.resumen.diferencia < 0 ? "atencion" : "critico"}>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {data.resumen.diferencia < 0 ? `Salieron ${NUM.format(Math.abs(data.resumen.diferencia))} unidades menos` : `Salieron ${NUM.format(data.resumen.diferencia)} de más`}
                  </Chip>
                )}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-4">
                <Cifra label="Pidió la orden" valor={NUM.format(data.resumen.pedido)} unidad="unidades" tamano="compacta" />
                <Cifra label="Se despachó" valor={NUM.format(data.resumen.despachado)} unidad="unidades" tono={data.resumen.cuadra ? "ok" : data.resumen.diferencia < 0 ? "atencion" : "critico"} tamano="compacta" />
                <Cifra label="Averías en el cargue" valor={NUM.format(data.resumen.averias)} unidad={data.resumen.averias > 0 ? "explican el faltante" : "ninguna"} tamano="compacta" />
                <Cifra label="Báscula" valor={data.pesoBascula != null ? T1.format(data.pesoBascula) : "—"} unidad={data.tiqueteBascula ? `t · tiquete ${data.tiqueteBascula}` : "t"} tamano="compacta" />
              </div>
            </section>

            {/* Vehículo y quiénes */}
            <Seccion eyebrow="Vehículo y equipo" titulo={`${data.placa ?? "Sin placa"}${data.conductor ? ` · ${data.conductor}` : ""}`} accion={data.estado ? <Chip tono={String(data.estado).toLowerCase() === "finalizado" ? "ok" : "info"}>{data.estado}</Chip> : undefined}>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {data.transporte && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Transporte</dt><dd className="font-medium">{data.transporte}</dd></div>}
                {data.muelle && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Muelle</dt><dd className="lg-num font-medium">{data.muelle}</dd></div>}
                {data.modoCarga && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Modo de carga</dt><dd className="font-medium">{data.modoCarga}</dd></div>}
                {data.asignoLotes && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Asignó lotes</dt><dd className="font-medium">{data.asignoLotes}</dd></div>}
                {data.cargaron.length > 0 && (
                  <div className="sm:col-span-2">
                    {/* "Cargaron" solo cuando es el registro real del vehículo; si no, se dice
                        que son los asignados, para no dar por hecho quién cargó. */}
                    <dt className="text-muted-foreground">{data.cargaronEsReal ? "Cargaron este vehículo" : "Asignados al vehículo"}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1.5">{data.cargaron.map((p) => <Chip key={p} tono="neutro">{p}</Chip>)}</dd>
                  </div>
                )}
                {data.sinRegistroDeCuadrilla && (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Cargaron este vehículo</dt>
                    <dd className="mt-1 text-xs text-muted-foreground">No quedó registrado quién cargó. El pago de ese día fue global, así que la lista de auxiliares es la de toda la jornada y no dice quién atendió esta orden.</dd>
                  </div>
                )}
              </dl>
            </Seccion>

            {/* Ciclo por producto */}
            <Seccion eyebrow="El ciclo, producto por producto" titulo="Orden · asignación · despacho" sinPadding>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2 text-left font-semibold">Producto</th>
                      <th className="px-3 py-2 text-right font-semibold">Pidió</th>
                      <th className="px-3 py-2 text-right font-semibold">Despachó</th>
                      <th className="px-3 py-2 text-right font-semibold">Avería</th>
                      <th className="px-3 py-2 text-right font-semibold">Diferencia</th>
                      <th className="px-5 py-2 text-left font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lineas.map((l) => (
                      <tr key={l.producto} className="border-t border-border/60 align-top">
                        <td className="px-5 py-2.5">
                          <p className="font-medium">{l.producto}</p>
                          {l.clientes.length > 0 && <p className="text-xs text-muted-foreground">{l.clientes.join(" · ")}</p>}
                          {l.lotes.length > 0 && (
                            <p className="lg-num mt-1 text-[11px] text-muted-foreground">
                              {l.lotes.map((x) => `lote ${x.lote} (${x.location})${x.estiba ? ` estiba ${x.estiba}` : ""}: ${NUM.format(x.cantidad)}`).join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="lg-num px-3 py-2.5 text-right">{NUM.format(l.pedido)}</td>
                        <td className="lg-num px-3 py-2.5 text-right font-semibold">{NUM.format(l.despachado)}</td>
                        <td className="lg-num px-3 py-2.5 text-right">{l.averias ? NUM.format(l.averias) : "—"}</td>
                        <td className={`lg-num px-3 py-2.5 text-right font-semibold ${l.diferencia === 0 ? "text-muted-foreground" : l.diferencia < 0 ? "text-atencion-fg" : "text-critico-fg"}`}>
                          {l.diferencia === 0 ? "0" : l.diferencia > 0 ? `+${NUM.format(l.diferencia)}` : NUM.format(l.diferencia)}
                        </td>
                        <td className="px-5 py-2.5">
                          <span className="flex items-center gap-1.5">
                            <Punto tono={TONO_LINEA[l.estado]} />
                            <span className="text-xs">{TEXTO_LINEA[l.estado]}</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.resumen.cuadra && (
                <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                  {data.resumen.diferencia < 0
                    ? "Salió menos de lo que pedía la orden. Si hay avería registrada, esa es la explicación; si no, conviene revisar con la bodega qué pasó."
                    : "Salió más de lo que autorizaba la orden. Esto no debería ocurrir: revísalo con la bodega."}
                </p>
              )}
            </Seccion>

            {/* Pedidos que atendió */}
            <Seccion eyebrow="Pedidos que atendió esta orden" titulo={data.pedidos.length ? `${data.pedidos.length} pedido${data.pedidos.length === 1 ? "" : "s"}` : "Sin pedido ligado"} sinPadding>
              {data.pedidos.length === 0 ? (
                <EstadoVacio titulo="Esta orden no tiene pedidos ligados" texto="Toda orden se arma a partir de pedidos: si ves esto, el vínculo no quedó registrado. Avísale a LIP con el número de la orden." />
              ) : (
                <ul className="divide-y divide-border">
                  {data.pedidos.map((p) => (
                    <li key={p.idpedido} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Pedido #{p.idpedido}{p.cliente ? ` · ${p.cliente}` : ""}</p>
                        <p className="lg-num text-xs text-muted-foreground">
                          {p.unidades ? `${NUM.format(p.unidades)} unidades` : "sin unidades"}
                          {p.fechaProgramada ? ` · prometido para el ${p.fechaProgramada}` : ""}
                          {p.fecha ? ` · registrado el ${p.fecha}` : ""}
                        </p>
                      </div>
                      {p.estado && <Chip tono={String(p.estado).toLowerCase() === "entregado" ? "ok" : "neutro"}>{p.estado}</Chip>}
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>

            {/* Tiempos del día */}
            {data.linea.length > 0 && (
              <Seccion eyebrow="Cómo transcurrió el día" titulo="Tiempos de la orden" sinPadding>
                <ul className="divide-y divide-border">
                  {data.linea.map((h) => (
                    <li key={h.paso} className="flex items-center justify-between gap-3 px-5 py-2">
                      <span className="flex items-center gap-2.5 text-sm"><Punto tono="info" />{h.paso}</span>
                      <span className="lg-num text-sm font-semibold">{h.hora}</span>
                    </li>
                  ))}
                </ul>
              </Seccion>
            )}

            {/* Documentos */}
            {data.documentos.length > 0 && (
              <Seccion eyebrow="Soportes" titulo="Documentos y fotos">
                <div className="flex flex-wrap gap-2">
                  {data.documentos.map((d) => (
                    <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
                      {d.nombre.toLowerCase().includes("foto") ? <Truck className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                      {d.nombre}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  ))}
                </div>
              </Seccion>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
