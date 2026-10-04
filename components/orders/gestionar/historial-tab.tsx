"use client"

// Pestaña "Historial": pedidos finalizados (entregados, entrega parcial, anulados y
// no entregados) por período, con filtros y exportación a Excel.

import { useEffect, useMemo, useState } from "react"
import { FileDown, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Chip, Esqueleto, EstadoVacio } from "@/components/ui/lipgo"
import { toast } from "@/hooks/use-toast"
import { getHistorialPedidos, type HistorialPedidos, type PedidoCola } from "@/lib/pedidos-cola-actions"
import { normalizarEstado } from "@/lib/pedidos-estado"
import { PERIODOS_LISTADO, PERIODO_LISTADO_DEFECTO, type PeriodoListado } from "@/lib/periodo-listados"
import { EstadoChip } from "./estado-chip"
import { NUM, fechaCorta, fechaCortaAnio } from "./formato"

type FiltroEstado = "todos" | "entregado" | "entrega parcial" | "anulado" | "no entregado"
const POR_PAGINA = 50

export function HistorialTab({ empresaId, onVerDetalle }: { empresaId: number | null; onVerDetalle: (p: PedidoCola) => void }) {
  const [periodo, setPeriodo] = useState<PeriodoListado>(PERIODO_LISTADO_DEFECTO)
  const [data, setData] = useState<HistorialPedidos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<FiltroEstado>("todos")
  const [cliente, setCliente] = useState("todos")
  const [vendedor, setVendedor] = useState("todos")
  const [despacho, setDespacho] = useState("todos")
  const [busqueda, setBusqueda] = useState("")
  const [pagina, setPagina] = useState(0)

  useEffect(() => {
    if (!empresaId) return
    setData(null)
    setError(null)
    setPagina(0)
    getHistorialPedidos(empresaId, periodo).then((r) => {
      if (r.success) setData(r.data)
      else setError(r.message)
    })
  }, [empresaId, periodo])

  const opciones = useMemo(() => {
    const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim() !== ""))].sort()
    return { clientes: u(data?.pedidos.map((p) => p.cliente) ?? []), vendedores: u(data?.pedidos.map((p) => p.vendedor) ?? []), despachos: u(data?.pedidos.map((p) => p.tipo_despacho) ?? []) }
  }, [data])

  const filtrados = useMemo(() => {
    if (!data) return []
    const q = busqueda.trim().toLowerCase()
    return data.pedidos.filter((p) => {
      if (estado !== "todos" && normalizarEstado(p.estado) !== estado) return false
      if (cliente !== "todos" && p.cliente !== cliente) return false
      if (vendedor !== "todos" && p.vendedor !== vendedor) return false
      if (despacho !== "todos" && p.tipo_despacho !== despacho) return false
      if (q && ![String(p.idpedido), p.pedido, p.orden_de_compra, p.cliente, p.ocargue, p.vehiculo, p.factura].some((v) => (v ?? "").toLowerCase().includes(q))) return false
      return true
    })
  }, [data, estado, cliente, vendedor, despacho, busqueda])

  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const pag = Math.min(pagina, paginas - 1)
  const visibles = filtrados.slice(pag * POR_PAGINA, pag * POR_PAGINA + POR_PAGINA)

  const exportar = async () => {
    if (filtrados.length === 0) {
      toast({ title: "No hay datos", description: "No hay pedidos para exportar con estos filtros.", variant: "destructive" })
      return
    }
    const XLSX = await import("xlsx")
    const filas = filtrados.map((p) => ({
      Pedido: p.idpedido,
      "N° cliente": p.pedido || "-",
      "Orden de compra": p.orden_de_compra || "-",
      Cliente: p.cliente,
      Vendedor: p.vendedor || "-",
      Despacho: p.tipo_despacho || "-",
      "Fecha registro": p.fecha,
      Promesa: p.fecha_programada || "-",
      Entrega: p.fechadeentrega || "-",
      "Orden de cargue": p.ocargue || "-",
      Vehículo: p.vehiculo || "-",
      Kilos: data?.kgOmitidos ? "" : p.kg,
      Unidades: data?.kgOmitidos ? "" : p.unidades,
      Estado: p.calc.etiqueta,
      "Estado en la base": p.estado || "-",
      Motivo: p.motivo_no_entrega || "-",
      "Depurado por": p.depurado_por || "-",
      "Depurado en": p.depurado_en || "-",
      "Total a pagar": p.total_pagar,
    }))
    const ws = XLSX.utils.json_to_sheet(filas)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Historial")
    XLSX.writeFile(wb, `Pedidos_historial_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (error) return <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-4 text-sm text-atencion-fg">{error}</div>

  const t = data?.totales

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Período</span>
          {PERIODOS_LISTADO.map((p) => (
            <button key={p.valor} type="button" onClick={() => setPeriodo(p.valor)} className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium ${periodo === p.valor ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}>
              {p.etiqueta}
            </button>
          ))}
          <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
          <Select value={cliente} onValueChange={(v) => { setCliente(v); setPagina(0) }}>
            <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Cliente" /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Cliente · todos</SelectItem>{opciones.clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={vendedor} onValueChange={(v) => { setVendedor(v); setPagina(0) }}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Vendedor · todos</SelectItem>{opciones.vendedores.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={despacho} onValueChange={(v) => { setDespacho(v); setPagina(0) }}>
            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Despacho" /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Despacho · todos</SelectItem>{opciones.despachos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["todos", "Todos", data?.pedidos.length ?? 0],
            ["entregado", "Entregado", t?.entregados ?? 0],
            ["entrega parcial", "Entrega parcial", t?.entregaParcial ?? 0],
            ["anulado", "Anulado", t?.anulados ?? 0],
            ["no entregado", "No entregado", t?.noEntregados ?? 0],
          ] as [FiltroEstado, string, number][]).map(([v, et, n]) => (
            <button key={v} type="button" onClick={() => { setEstado(v); setPagina(0) }} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${estado === v ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}>
              {et} <span className="lg-num">{NUM.format(n)}</span>
            </button>
          ))}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportar} disabled={!data}><FileDown className="h-3.5 w-3.5" /> Exportar Excel</Button>
        </div>
      </div>

      {!data ? (
        <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
      ) : filtrados.length === 0 ? (
        <div className="lg-card"><EstadoVacio titulo="No hay pedidos finalizados con estos filtros" texto="Amplía el período o quita filtros." /></div>
      ) : (
        <div className="lg-card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0) }} placeholder="Pedido, N°, OC, cliente, placa o factura" className="h-8 w-[300px] pl-8 text-xs" />
            </div>
            <span className="lg-num text-xs text-muted-foreground">{NUM.format(filtrados.length)} pedidos{data.desde ? ` desde ${fechaCortaAnio(data.desde)}` : " en todo el historial"}{data.kgOmitidos ? " · kilos no calculados en períodos tan amplios" : ""}</span>
          </div>
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-semibold">Pedido</th>
                <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                <th className="px-4 py-2.5 text-left font-semibold">Despacho</th>
                <th className="px-4 py-2.5 text-left font-semibold">Promesa</th>
                <th className="px-4 py-2.5 text-left font-semibold">Entrega</th>
                <th className="px-4 py-2.5 text-left font-semibold">Orden de cargue</th>
                <th className="px-4 py-2.5 text-left font-semibold">Vehículo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Kilos</th>
                <th className="px-4 py-2.5 text-left font-semibold">Estado</th>
                <th className="px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.idpedido} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-2.5"><span className="lg-num font-semibold">#{p.idpedido}</span><span className="lg-num block text-xs text-muted-foreground">{p.pedido ? `N° ${p.pedido}` : p.orden_de_compra ? `OC ${p.orden_de_compra}` : fechaCorta(p.fecha)}</span></td>
                  <td className="max-w-[300px] px-4 py-2.5"><span className="block truncate font-medium" title={p.cliente}>{p.cliente}</span><span className="block truncate text-xs text-muted-foreground">{p.vendedor || "—"}</span></td>
                  <td className="px-4 py-2.5"><Chip tono="neutro">{p.tipo_despacho || "sin tipo"}</Chip></td>
                  <td className="lg-num px-4 py-2.5">{fechaCorta(p.fecha_programada)}</td>
                  <td className="lg-num px-4 py-2.5">{p.fechadeentrega ? <>{fechaCorta(p.fechadeentrega)}{p.fecha_programada && p.fechadeentrega < p.fecha_programada ? <span className="block text-xs text-muted-foreground">antes de la promesa</span> : null}</> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="lg-num px-4 py-2.5">{p.ocargue || <span className="text-muted-foreground">—</span>}</td>
                  <td className="lg-num px-4 py-2.5">{p.vehiculo || <span className="text-muted-foreground">—</span>}</td>
                  <td className="lg-num px-4 py-2.5 text-right">{data.kgOmitidos ? "—" : NUM.format(p.kg)}</td>
                  <td className="px-4 py-2.5"><EstadoChip calc={p.calc} title={p.motivo_no_entrega ? `${p.motivo_no_entrega}${p.depurado_por ? ` · ${p.depurado_por}` : ""}` : undefined} /></td>
                  <td className="px-2 py-2.5"><Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onVerDetalle(p)}>Ver</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span>El Excel lleva pedido, N° del cliente, OC, cliente, vendedor, despacho, fechas, orden de cargue, vehículo, kilos, unidades, estado y motivo de depuración.</span>
            <div className="flex items-center gap-2">
              <span className="lg-num">Página {pag + 1} de {paginas}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
