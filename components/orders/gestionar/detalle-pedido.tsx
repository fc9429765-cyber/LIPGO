"use client"

// Detalle de un pedido: línea de tiempo (registrado → cartera → aprobado → promesa →
// orden de cargue → entrega → cierre), datos y líneas. Solo lectura; las acciones
// se disparan hacia el cascarón.

import { useEffect, useState } from "react"
import { Check, FileText, Pencil, Truck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Chip, Esqueleto, Eyebrow } from "@/components/ui/lipgo"
import { getLineasPedido, type LineaPedido, type PedidoCola } from "@/lib/pedidos-cola-actions"
import { normalizarEstado } from "@/lib/pedidos-estado"
import { EstadoChip } from "./estado-chip"
import { COP, NUM, fechaCorta, fechaLarga, horaCorta, kgTexto } from "./formato"
import type { TipoAccion } from "./acciones-pedido"

type Paso = { titulo: string; detalle: string; estado: "hecho" | "actual" | "pendiente" | "cancelado" }

function pasosDe(p: PedidoCola): Paso[] {
  const c = p.calc
  const est = normalizarEstado(p.estado)
  const registrado: Paso = { titulo: "Registrado", detalle: `${fechaCorta(p.fecha)}${p.creado_en ? ` · ${horaCorta(p.creado_en)}` : " · sin hora"}`, estado: "hecho" }
  const cartera: Paso = { titulo: "Cartera", detalle: p.revisioncartera || "pendiente", estado: p.revisioncartera ? "hecho" : c.estado === "nuevo" ? "actual" : "pendiente" }
  const aprobado: Paso = {
    titulo: "Aprobado",
    detalle: p.revisiongerencia || (normalizarEstado(p.aprobado) === "si" ? "sí" : "pendiente"),
    estado: normalizarEstado(p.aprobado) === "si" ? "hecho" : c.estado === "nuevo" && p.revisioncartera ? "actual" : "pendiente",
  }
  const promesa: Paso = {
    titulo: "Promesa",
    detalle: p.fecha_programada ? `${fechaCorta(p.fecha_programada)}${c.esHoy ? " · hoy" : c.atrasoDias > 0 && !c.esFinal && c.sinRastro ? ` · atrasado ${c.atrasoDias} d` : ""}` : "sin fecha",
    estado: c.estado === "programado" || c.estado === "aprobado_sin_programar" ? "actual" : normalizarEstado(p.aprobado) === "si" || !c.sinRastro ? "hecho" : "pendiente",
  }
  const oc: Paso = {
    titulo: "Orden de cargue",
    detalle: p.ocargue ? `${p.ocargue}${p.vehiculo ? ` · ${p.vehiculo}` : ""}${p.fechaordencargue ? ` · ${fechaCorta(p.fechaordencargue)}` : ""}` : p.fechaordencargue ? `${fechaCorta(p.fechaordencargue)}${p.vehiculo ? ` · ${p.vehiculo}` : ""}` : "pendiente",
    estado: p.ocargue || p.fechaordencargue || p.lineasConOcargue > 0 ? "hecho" : c.estado === "en_cargue" ? "actual" : "pendiente",
  }
  const entrega: Paso = {
    titulo: "Entrega",
    detalle: p.fechadeentrega ? `${fechaCorta(p.fechadeentrega)} · ${NUM.format(p.unidadesCargadas)} de ${NUM.format(p.unidades)} und` : p.unidadesCargadas > 0 ? `${NUM.format(p.unidadesCargadas)} de ${NUM.format(p.unidades)} und` : "—",
    estado: est === "entregado" || est === "entrega parcial" || p.fechadeentrega ? "hecho" : c.estado === "parcial" || c.estado === "en_cargue" ? "actual" : "pendiente",
  }
  let cierre: Paso = { titulo: "Cierre", detalle: p.factura ? `Factura ${p.factura}` : "—", estado: p.factura || est === "entregado" || est === "entrega parcial" ? "hecho" : "pendiente" }
  if (est === "anulado") cierre = { titulo: "Anulado", detalle: p.observaciones || "sin observación", estado: "cancelado" }
  if (est === "no entregado") cierre = { titulo: "No entregado", detalle: `${p.motivo_no_entrega || "sin motivo"}${p.depurado_por ? ` · ${p.depurado_por}` : ""}${p.depurado_en ? ` · ${fechaCorta(p.depurado_en)} ${horaCorta(p.depurado_en)}` : ""}`, estado: "cancelado" }
  if (est === "entrega parcial" && p.motivo_no_entrega) cierre = { titulo: "Entrega parcial", detalle: `${p.motivo_no_entrega}${p.depurado_por ? ` · ${p.depurado_por}` : ""}`, estado: "hecho" }
  return [registrado, cartera, aprobado, promesa, oc, entrega, cierre]
}

export function DetallePedido({
  empresaId,
  idpedido,
  onClose,
  onAccion,
  onEditar,
  onGenerarOC,
  onVerOC,
  permisos,
}: {
  empresaId: number | null
  idpedido: number | null
  onClose: () => void
  onAccion: (tipo: TipoAccion, pedido: PedidoCola) => void
  onEditar: (pedido: PedidoCola) => void
  onGenerarOC: (pedido: PedidoCola) => void
  onVerOC: (pedido: PedidoCola) => void
  permisos: { generarOC: boolean; verOC: boolean }
}) {
  const [data, setData] = useState<{ cabecera: PedidoCola; lineas: LineaPedido[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    if (!idpedido || !empresaId) return
    getLineasPedido(empresaId, idpedido).then((r) => {
      if (r.success) setData(r.data)
      else setError(r.message)
    })
  }, [empresaId, idpedido])

  const abierto = idpedido != null
  const p = data?.cabecera
  const c = p?.calc
  const aprobado = p ? normalizarEstado(p.aprobado) === "si" : false

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 pt-6 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Eyebrow>Pedido{p?.empresa ? ` · ${p.empresa}` : ""}</Eyebrow>
              <DialogTitle className="lg-num mt-1 flex flex-wrap items-center gap-2 text-xl">
                #{idpedido}
                {p?.pedido ? ` · N° ${p.pedido}` : ""}
                {p?.orden_de_compra ? <span className="text-base font-medium text-muted-foreground">OC {p.orden_de_compra}</span> : null}
                {c && <EstadoChip calc={c} />}
              </DialogTitle>
              <DialogDescription className="mt-1">
                {p ? `${p.cliente} · ${p.tipo_despacho || "sin tipo de despacho"} · registrado el ${fechaLarga(p.fecha)}${p.vendedor ? ` por ${p.vendedor}` : ""}` : "Cargando…"}
              </DialogDescription>
            </div>
            {p && (
              <div className="flex flex-wrap gap-2">
                {p.pdfpedido && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(p.pdfpedido!, "_blank")}>
                    <FileText className="h-3.5 w-3.5" /> Ver PDF
                  </Button>
                )}
                {c?.estado === "nuevo" && !c.conCartera && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onEditar(p)}>
                    <Pencil className="h-3.5 w-3.5" /> Editar
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogHeader>

        {error && <p className="px-6 py-6 text-sm text-critico-fg">{error}</p>}
        {!error && !p && (
          <div className="px-6 py-6">
            <Esqueleto lineas={6} />
          </div>
        )}

        {p && c && (
          <>
            <div className="border-b border-border px-6 py-4">
              <Eyebrow className="text-muted-foreground">Línea de tiempo</Eyebrow>
              <ol className="mt-3 grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
                {pasosDe(p).map((paso, i) => (
                  <li key={paso.titulo} className="relative flex flex-col gap-1.5 pr-2">
                    {i < 6 && <span aria-hidden className={`absolute left-7 right-0 top-[11px] hidden h-0.5 lg:block ${paso.estado === "hecho" ? "bg-acento" : "bg-border"}`} />}
                    <span
                      className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 ${
                        paso.estado === "hecho"
                          ? "border-acento bg-acento text-white"
                          : paso.estado === "actual"
                            ? "border-blue-700 bg-white shadow-[0_0_0_4px_#DBEAFE]"
                            : paso.estado === "cancelado"
                              ? "border-slate-400 bg-slate-400 text-white"
                              : "border-slate-300 bg-white"
                      }`}
                    >
                      {paso.estado === "hecho" && <Check className="h-3 w-3" strokeWidth={3} />}
                      {paso.estado === "actual" && <span className="block h-2 w-2 rounded-full bg-blue-700" />}
                      {paso.estado === "cancelado" && <X className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className={`text-xs font-semibold leading-tight ${paso.estado === "actual" ? "text-info-fg" : paso.estado === "pendiente" ? "text-muted-foreground" : ""}`}>{paso.titulo}</span>
                    <span className="lg-num text-xs leading-snug text-muted-foreground">{paso.detalle}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="grid gap-0 lg:grid-cols-[5fr_7fr]">
              <div className="border-b border-border px-6 py-4 lg:border-b-0 lg:border-r">
                <Eyebrow className="text-muted-foreground">Datos del pedido</Eyebrow>
                <dl className="mt-2 text-sm">
                  {[
                    ["Cliente", p.cliente],
                    ["Sucursal · destino", `${p.medio || "—"} · ${p.destino || "—"}`],
                    ["Dirección", p.direccion || "—"],
                    ["Bodega origen", p.empresa || "—"],
                    ["Empresa que factura", p.empresafactura || "—"],
                    ["Vendedor", p.vendedor || "—"],
                    ["Despacho", p.tipo_despacho || "—"],
                    ["Condición de pago", p.condicion_pago || "—"],
                    ["OC del cliente", p.orden_de_compra || "—"],
                    ["Transporte", p.transporte || "—"],
                    ["Observaciones", p.observaciones || "—"],
                    ["Total a pagar", p.total_pagar > 0 ? COP.format(p.total_pagar) : "sin valor"],
                    ["Estado en la base", `estado = ${p.estado ?? "null"} · aprobado = ${p.aprobado ?? "—"}`],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-t border-border/60 py-2 first:border-t-0">
                      <dt className="shrink-0 text-muted-foreground">{k}</dt>
                      <dd className="lg-num text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="py-4">
                <div className="flex items-center justify-between px-6 pb-2">
                  <Eyebrow className="text-muted-foreground">Líneas · {data!.lineas.length}</Eyebrow>
                  <span className="lg-num text-xs text-muted-foreground">
                    {NUM.format(p.unidades)} und · {kgTexto(p.kg)}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Producto</th>
                        <th className="px-3 py-2 text-right font-semibold">Und</th>
                        <th className="px-3 py-2 text-right font-semibold">Kg</th>
                        <th className="px-3 py-2 text-right font-semibold">Precio</th>
                        <th className="px-3 py-2 text-right font-semibold">Total</th>
                        <th className="px-4 py-2 text-right font-semibold">Cargadas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data!.lineas.map((l) => (
                        <tr key={l.transid} className="border-t border-border/60">
                          <td className="px-4 py-2">
                            <span className="font-medium">{l.producto}</span>
                            {l.categoria && <span className="block text-[11px] text-muted-foreground">{l.categoria}{l.ocargue ? ` · OC ${l.ocargue}` : ""}</span>}
                          </td>
                          <td className="lg-num px-3 py-2 text-right">{NUM.format(l.unidades)}</td>
                          <td className="lg-num px-3 py-2 text-right">{NUM.format(Math.round(l.peso))}</td>
                          <td className="lg-num px-3 py-2 text-right">{l.precio_und > 0 ? NUM.format(l.precio_und) : "—"}</td>
                          <td className="lg-num px-3 py-2 text-right">{l.total_linea > 0 ? NUM.format(l.total_linea) : "—"}</td>
                          <td className="lg-num px-4 py-2 text-right text-muted-foreground">
                            {NUM.format(l.unidadescargadas)}
                            {l.unidades - l.unidadescargadas > 0 ? ` · faltan ${NUM.format(l.unidades - l.unidadescargadas)}` : ""}
                          </td>
                        </tr>
                      ))}
                      {data!.lineas.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Este pedido no tiene líneas.</td></tr>}
                    </tbody>
                    {data!.lineas.length > 0 && (
                      <tfoot className="bg-muted/40 font-semibold">
                        <tr>
                          <td className="px-4 py-2">Total</td>
                          <td className="lg-num px-3 py-2 text-right">{NUM.format(p.unidades)}</td>
                          <td className="lg-num px-3 py-2 text-right">{NUM.format(p.kg)}</td>
                          <td></td>
                          <td className="lg-num px-3 py-2 text-right">{p.total_pagar > 0 ? NUM.format(p.total_pagar) : "—"}</td>
                          <td className="lg-num px-4 py-2 text-right text-muted-foreground">{NUM.format(p.unidadesCargadas)} de {NUM.format(p.unidades)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>

            {!c.esFinal && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
                <p className="text-xs text-muted-foreground">
                  {c.siguientePaso ? `Siguiente paso: ${c.siguientePaso.texto.toLowerCase()}.` : ""} Las acciones con clave quedan registradas con quién las autorizó.
                </p>
                <div className="flex flex-wrap gap-2">
                  {c.estado === "nuevo" && !c.conCartera && <Button variant="outline" size="sm" onClick={() => onAccion("eliminar", p)}>Eliminar</Button>}
                  {c.estado === "nuevo" && !c.conCartera && <Button size="sm" onClick={() => onAccion("cartera", p)}>Aprobar cartera</Button>}
                  {c.estado === "nuevo" && c.conCartera && <Button size="sm" onClick={() => onAccion("aprobar", p)}>Aprobar</Button>}
                  {aprobado && c.sinRastro && c.estado !== "parcial" && <Button variant="outline" size="sm" onClick={() => onAccion("anular", p)}>Anular…</Button>}
                  {aprobado && <Button variant="outline" size="sm" onClick={() => onAccion("cierre_factura", p)}>Cierre con factura</Button>}
                  {c.estado === "parcial" && <Button variant="outline" size="sm" onClick={() => onAccion("cerrar_pendiente", p)}>Cerrar pendiente</Button>}
                  {(c.estado === "en_cargue" || c.estado === "parcial") && (p.ocargue || p.lineasConOcargue > 0) && permisos.verOC && (
                    <Button variant="outline" size="sm" onClick={() => onVerOC(p)}>Ver orden de cargue</Button>
                  )}
                  {c.estado === "programado" && permisos.generarOC && (
                    <Button size="sm" className="gap-1.5" onClick={() => onGenerarOC(p)}>
                      <Truck className="h-3.5 w-3.5" /> Generar orden de cargue
                    </Button>
                  )}
                  {c.estado === "programado" && !permisos.generarOC && <Chip tono="info">Espera orden de cargue de Recepción y Despacho</Chip>}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
