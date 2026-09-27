"use client"

// Módulo "Transacciones de Inventario" rediseñado (2026-08-08):
//   1. Movimiento por código (principal, estilo SAP)
//   2. Formulario clásico (el componente existente, INTACTO)
//   3. Consulta de movimientos (cualquier movimiento, desde–hasta, Excel)
//   4. Historial de correcciones (inv_correcciones_log, revisable sin tocar invtrans)

import { useEffect, useMemo, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { Loader2, Download, Search } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { InventoryTransactionsForm } from "@/components/inventory-transactions-form"
import { TransaccionesPorCodigo } from "@/components/transacciones-por-codigo"
import {
  getConsultaMovimientos,
  getHistorialCorrecciones,
  getProductosDeEmpresa,
  getAjustesPendientes,
  aprobarAjustePendiente,
  rechazarAjustePendiente,
  getStockCuarentena,
  type StockCuarentenaRow,
} from "@/lib/transacciones-codigo-actions"
import { FIELDSETS, GUIA_TRANSACCIONES, type CorreccionLogRow, type AjustePendiente } from "@/lib/transacciones-codigo"
import { ShieldCheck, BookOpen, Check, X } from "lucide-react"

const hoyColombia = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())

const fmtFechaHora = (iso: any) => {
  if (!iso) return ""
  try {
    return new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "short", timeStyle: "short" }).format(new Date(String(iso)))
  } catch {
    return String(iso).slice(0, 16)
  }
}

// ---------------------------------------------------------------------------
// Pestaña 3 — Consulta de movimientos
// ---------------------------------------------------------------------------

function ConsultaMovimientos() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()
  const [desde, setDesde] = useState(hoyColombia())
  const [hasta, setHasta] = useState(hoyColombia())
  const [producto, setProducto] = useState("")
  const [catalogoProductos, setCatalogoProductos] = useState<{ nombre: string; codigo: string }[]>([])

  // Productos SOLO del proyecto elegido en el selector global.
  useEffect(() => {
    if (!selectedEmpresaId) { setCatalogoProductos([]); return }
    getProductosDeEmpresa(selectedEmpresaId).then((r) => setCatalogoProductos(r.success ? r.data : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])
  const [lote, setLote] = useState("")
  const [tipomov, setTipomov] = useState("")
  const [codigo, setCodigo] = useState("")
  const [usuario, setUsuario] = useState("")
  const [filas, setFilas] = useState<any[]>([])
  const [truncado, setTruncado] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [consultado, setConsultado] = useState(false)

  const consultar = async () => {
    if (!selectedEmpresaId) return
    setCargando(true)
    const r = await getConsultaMovimientos({
      selectedEmpresaId,
      desde,
      hasta,
      producto: producto || null,
      lote: lote || null,
      tipomov: tipomov || null,
      codigo: codigo || null,
      usuario: usuario || null,
    })
    setCargando(false)
    setConsultado(true)
    if (r.success) {
      setFilas(r.data)
      setTruncado(r.truncado)
    } else toast({ title: "No se pudo consultar", description: r.error, variant: "destructive" })
  }

  const exportarExcel = async () => {
    const XLSX = await import("xlsx")
    const data = filas.map((f) => ({
      "#": f.id,
      Fecha: fmtFechaHora(f.creado),
      "Cód. Mov.": f.cod_movimiento || "",
      Tipo: f.tipomov,
      "Código Producto": f.codproducto,
      Producto: f.nombreproducto,
      Lote: f.lote,
      Ubicación: f.location,
      Almacén: f.almacen || "",
      Cantidad: f.cantidad,
      Estado: f.status,
      Origen: f.origen,
      Orden: f.ocargue || "",
      Usuario: f.creadopor,
      Observaciones: f.observaciones || "",
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Movimientos")
    XLSX.writeFile(wb, `movimientos_${desde}_a_${hasta}.xlsx`)
  }

  if (!selectedEmpresaId) return <p className="py-8 text-center text-sm text-muted-foreground">Selecciona un proyecto en el selector global.</p>

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Desde</Label>
          <DatePickerField value={desde} onChange={setDesde} className="mt-1 h-9 w-40" />
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Hasta</Label>
          <DatePickerField value={hasta} onChange={setHasta} className="mt-1 h-9 w-40" />
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Producto / código</Label>
          <Input list="consulta-productos" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Todos — elige o escribe" className="mt-1 h-9 w-56" />
          <datalist id="consulta-productos">
            {catalogoProductos.map((p) => (
              <option key={p.nombre} value={p.nombre}>{p.codigo}</option>
            ))}
            {catalogoProductos.map((p) => (
              <option key={`c-${p.nombre}`} value={p.codigo}>{p.nombre}</option>
            ))}
          </datalist>
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Lote</Label>
          <Input value={lote} onChange={(e) => setLote(e.target.value)} placeholder="Lote" className="mt-1 h-9 w-32" />
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Tipo</Label>
          <Select value={tipomov || "todos"} onValueChange={(v) => setTipomov(v === "todos" ? "" : v)}>
            <SelectTrigger className="mt-1 h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="Entrada">Entrada</SelectItem>
              <SelectItem value="Salida">Salida</SelectItem>
              <SelectItem value="Reproceso">Reproceso</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Cód. mov.</Label>
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="Ej: 309" className="mt-1 h-9 w-24 font-mono" />
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Usuario</Label>
          <Input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Quién lo hizo" className="mt-1 h-9 w-36" />
        </div>
        <Button onClick={consultar} disabled={cargando} className="h-9">
          {cargando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />} Consultar
        </Button>
        <Button variant="outline" onClick={exportarExcel} disabled={!filas.length} className="h-9">
          <Download className="mr-1 h-4 w-4" /> Excel
        </Button>
      </Card>

      {consultado && (
        <Card className="overflow-hidden">
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Cód.</th>
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Producto</th>
                  <th className="px-2 py-2">Lote</th>
                  <th className="px-2 py-2">Ubic.</th>
                  <th className="px-2 py-2 text-right">Cantidad</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Origen</th>
                  <th className="px-2 py-2">Orden</th>
                  <th className="px-2 py-2">Usuario</th>
                  <th className="px-2 py-2">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-b last:border-0 align-top">
                    <td className="px-2 py-1.5 font-mono text-xs">{f.id}</td>
                    <td className="px-2 py-1.5 text-xs">{fmtFechaHora(f.creado)}</td>
                    <td className="px-2 py-1.5"><Badge variant="outline" className="font-mono text-[10px]">{f.cod_movimiento || "—"}</Badge></td>
                    <td className="px-2 py-1.5 text-xs">{f.tipomov}</td>
                    <td className="px-2 py-1.5 text-xs">
                      <div>{f.nombreproducto}</div>
                      <div className="text-muted-foreground">{f.codproducto}</div>
                    </td>
                    <td className="px-2 py-1.5 text-xs">{f.lote}</td>
                    <td className="px-2 py-1.5 text-xs">{f.location}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: f.tipomov === "Entrada" ? "#1E8449" : "#C0392B" }}>{Number(f.cantidad).toLocaleString("es-CO")}</td>
                    <td className="px-2 py-1.5 text-xs">{f.status}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{f.origen}</td>
                    <td className="px-2 py-1.5 text-xs">{f.ocargue || "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{f.creadopor}</td>
                    <td className="max-w-[240px] px-2 py-1.5 text-xs text-muted-foreground">{f.observaciones}</td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={13} className="px-3 py-6 text-center text-sm text-muted-foreground">Sin movimientos en el rango.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="p-2 text-[11px] text-muted-foreground">
            {filas.length.toLocaleString("es-CO")} movimiento(s){truncado ? " · resultado recortado a 5.000 — afina el rango o los filtros" : ""}.
          </p>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pestaña 4 — Historial de correcciones (inv_correcciones_log)
// ---------------------------------------------------------------------------

function HistorialCorrecciones() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()
  const [filas, setFilas] = useState<CorreccionLogRow[]>([])
  const [cargando, setCargando] = useState(false)
  const [codigo, setCodigo] = useState("")
  const [producto, setProducto] = useState("")
  const [catalogoProductos, setCatalogoProductos] = useState<{ nombre: string; codigo: string }[]>([])

  // Productos SOLO del proyecto elegido en el selector global.
  useEffect(() => {
    if (!selectedEmpresaId) { setCatalogoProductos([]); return }
    getProductosDeEmpresa(selectedEmpresaId).then((r) => setCatalogoProductos(r.success ? r.data : []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const cargar = async () => {
    if (!selectedEmpresaId) return
    setCargando(true)
    const r = await getHistorialCorrecciones({ selectedEmpresaId, codigo: codigo || null, producto: producto || null })
    setCargando(false)
    if (r.success) setFilas(r.data)
    else toast({ title: "No se pudo cargar el historial", description: r.error, variant: "destructive" })
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const exportarExcel = async () => {
    const XLSX = await import("xlsx")
    const data = filas.map((f) => ({
      "#": f.id,
      Fecha: fmtFechaHora(f.created_at),
      Código: f.codigo,
      Producto: f.producto,
      "Cód. Producto": f.codproducto,
      "Lote origen": f.lote_origen,
      "Ubic. origen": f.location_origen,
      "Producto destino": f.producto_destino || "",
      "Lote destino": f.lote_destino || "",
      "Ubic. destino": f.location_destino || "",
      Cantidad: f.cantidad,
      Motivo: f.motivo || "",
      "Realizado por": f.realizado_por,
      "Autorizado por": f.autorizado_por || "",
      "Ref. original": f.ref_invtrans_id || "",
      "Movs. invtrans": Array.isArray(f.invtrans_ids) ? f.invtrans_ids.join(", ") : "",
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Correcciones")
    XLSX.writeFile(wb, `historial_correcciones_${hoyColombia()}.xlsx`)
  }

  if (!selectedEmpresaId) return <p className="py-8 text-center text-sm text-muted-foreground">Selecciona un proyecto en el selector global.</p>

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Código</Label>
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="Ej: 309" className="mt-1 h-9 w-24 font-mono" />
        </div>
        <div>
          <Label className="text-[11px] uppercase text-muted-foreground">Producto / código</Label>
          <Input list="historial-productos" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Todos — elige o escribe" className="mt-1 h-9 w-56" />
          <datalist id="historial-productos">
            {catalogoProductos.map((p) => (
              <option key={p.nombre} value={p.nombre}>{p.codigo}</option>
            ))}
            {catalogoProductos.map((p) => (
              <option key={`c-${p.nombre}`} value={p.codigo}>{p.nombre}</option>
            ))}
          </datalist>
        </div>
        <Button onClick={cargar} disabled={cargando} className="h-9">
          {cargando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />} Actualizar
        </Button>
        <Button variant="outline" onClick={exportarExcel} disabled={!filas.length} className="h-9">
          <Download className="mr-1 h-4 w-4" /> Excel
        </Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2">Cód.</th>
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2">Origen (lote · ubic.)</th>
                <th className="px-2 py-2">Destino</th>
                <th className="px-2 py-2 text-right">Cantidad</th>
                <th className="px-2 py-2">Motivo</th>
                <th className="px-2 py-2">Realizó</th>
                <th className="px-2 py-2">Autorizó</th>
                <th className="px-2 py-2">Evidencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b last:border-0 align-top">
                  <td className="px-2 py-1.5 text-xs">{fmtFechaHora(f.created_at)}</td>
                  <td className="px-2 py-1.5"><Badge variant="outline" className="font-mono text-[10px]">{f.codigo}</Badge></td>
                  <td className="px-2 py-1.5 text-xs">
                    <div>{f.producto}</div>
                    <div className="text-muted-foreground">{f.codproducto}</div>
                  </td>
                  <td className="px-2 py-1.5 text-xs">{f.lote_origen} · {f.location_origen}</td>
                  <td className="px-2 py-1.5 text-xs">
                    {f.lote_destino || f.location_destino || f.producto_destino
                      ? `${f.producto_destino && f.producto_destino !== f.producto ? f.producto_destino + " · " : ""}${f.lote_destino || f.lote_origen} · ${f.location_destino || f.location_origen}`
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(f.cantidad).toLocaleString("es-CO")}</td>
                  <td className="max-w-[220px] px-2 py-1.5 text-xs text-muted-foreground">{f.motivo || "—"}</td>
                  <td className="px-2 py-1.5 text-xs">{f.realizado_por}</td>
                  <td className="px-2 py-1.5 text-xs">{f.autorizado_por || "—"}</td>
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">
                    {f.ref_invtrans_id ? `reversa #${f.ref_invtrans_id} · ` : ""}
                    {Array.isArray(f.invtrans_ids) ? `invtrans ${f.invtrans_ids.join(", ")}` : ""}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">Aún no hay correcciones registradas en este proyecto.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pestaña — Aprobaciones pendientes (601/702, SQL 62)
// ---------------------------------------------------------------------------
// Incidente 2026-09-23 (Cedi Funza): un coordinador generó un Descargue
// manual duplicado (el clon automático desde Avimol ya existía) -- la nómina
// pagó doble a los mismos auxiliares, y para "cuadrar" el inventario generó
// una salida por código (702) que no resolvió nada y quedó invisible para
// Facturación. 601 ("Despacho manual") y 702 ("Faltante") son los únicos
// códigos que sacan producto sin orden de cargue y sin ser avería/reproceso
// (551, que sigue igual) -- ahora quedan pendientes de aprobación de Gerencia
// con una clave dedicada (distinta de la clave de responsable de movimiento).

const NOMBRE_EMPRESA: Record<number, string> = {
  1: "Harinera Indupan",
  2: "Avimol",
  3: "Cedi Funza",
  4: "Cedi Medellín",
}

function AprobacionesPendientes() {
  const { toast } = useToast()
  const [filas, setFilas] = useState<AjustePendiente[]>([])
  const [cargando, setCargando] = useState(false)
  const [seleccion, setSeleccion] = useState<AjustePendiente | null>(null)
  const [accion, setAccion] = useState<"aprobar" | "rechazar" | null>(null)
  const [clave, setClave] = useState("")
  const [motivoRechazo, setMotivoRechazo] = useState("")
  const [enviando, setEnviando] = useState(false)

  const cargar = async () => {
    setCargando(true)
    const r = await getAjustesPendientes({})
    setCargando(false)
    if (r.success) setFilas(r.data)
    else toast({ title: "No se pudo cargar", description: r.message, variant: "destructive" })
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cerrarDialogo = () => {
    setSeleccion(null)
    setAccion(null)
    setClave("")
    setMotivoRechazo("")
  }

  const confirmar = async () => {
    if (!seleccion || !accion) return
    setEnviando(true)
    const r =
      accion === "aprobar"
        ? await aprobarAjustePendiente(seleccion.id, clave)
        : await rechazarAjustePendiente(seleccion.id, clave, motivoRechazo)
    setEnviando(false)
    if (r.success) {
      toast({ title: accion === "aprobar" ? "Ajuste aprobado" : "Ajuste rechazado", description: r.message })
      cerrarDialogo()
      cargar()
    } else {
      toast({ title: "No se pudo completar", description: r.message, variant: "destructive" })
    }
  }

  return (
    <div className="space-y-3">
      <Card className="p-3 text-sm text-muted-foreground">
        Los códigos <b>601</b> (Despacho manual), <b>702</b> (Faltante de conteo) y <b>555</b> (Desecho por calidad desde
        cuarentena) sacan producto sin una orden de cargue detrás — quedan aquí, sin tocar el inventario, hasta que la
        <b> gerencia del proyecto</b> los apruebe o los rechace con su clave. Mira la columna "Stock hoy": si es menor a lo
        pedido, el producto ya salió por otra vía y la solicitud se rechaza.
      </Card>

      <Card className="overflow-hidden">
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-2 py-2">Fecha</th>
                <th className="px-2 py-2">Proyecto</th>
                <th className="px-2 py-2">Cód.</th>
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2">Lote · Ubic.</th>
                <th className="px-2 py-2 text-right">Cantidad</th>
                <th className="px-2 py-2 text-right">Stock hoy</th>
                <th className="px-2 py-2">Motivo</th>
                <th className="px-2 py-2">Solicitó</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b last:border-0 align-top">
                  <td className="px-2 py-1.5 text-xs">{fmtFechaHora(f.created_at)}</td>
                  <td className="px-2 py-1.5 text-xs">{NOMBRE_EMPRESA[f.idempresa] || f.idempresa}</td>
                  <td className="px-2 py-1.5"><Badge variant="outline" className="font-mono text-[10px]">{f.codigo}</Badge></td>
                  <td className="px-2 py-1.5 text-xs">{f.producto}</td>
                  <td className="px-2 py-1.5 text-xs">{f.lote} · {f.location}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(f.cantidad).toLocaleString("es-CO")}</td>
                  {/* Stock actual del lote/ubicación: si es menor que lo pedido, el
                      ajuste ya no aplica (el producto salió por otro movimiento
                      después de la solicitud) -- se debe rechazar, no aprobar. */}
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums text-xs ${
                      f.stock_actual != null && f.stock_actual < Number(f.cantidad) ? "font-semibold text-red-600" : "text-muted-foreground"
                    }`}
                    title={f.stock_actual != null && f.stock_actual < Number(f.cantidad) ? "Stock insuficiente: el ajuste ya no aplica tal cual" : undefined}
                  >
                    {f.stock_actual == null ? "—" : Number(f.stock_actual).toLocaleString("es-CO")}
                    {f.stock_actual != null && f.stock_actual < Number(f.cantidad) && <span className="block text-[10px] font-normal">insuficiente</span>}
                  </td>
                  <td className="max-w-[220px] px-2 py-1.5 text-xs text-muted-foreground">{f.motivo || "—"}</td>
                  <td className="px-2 py-1.5 text-xs">{f.solicitado_por}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" style={{ color: "#1E8449", borderColor: "#1E8449" }} onClick={() => { setSeleccion(f); setAccion("aprobar") }}>
                        <Check className="h-3.5 w-3.5" /> Aprobar
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" style={{ color: "#C0392B", borderColor: "#C0392B" }} onClick={() => { setSeleccion(f); setAccion("rechazar") }}>
                        <X className="h-3.5 w-3.5" /> Rechazar
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!cargando && filas.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">No hay solicitudes pendientes.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={!!seleccion} onOpenChange={(o) => !o && cerrarDialogo()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {accion === "aprobar" ? "Aprobar ajuste" : "Rechazar ajuste"} {seleccion?.codigo}
            </DialogTitle>
          </DialogHeader>
          {seleccion && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                <p>{NOMBRE_EMPRESA[seleccion.idempresa] || seleccion.idempresa} · {seleccion.producto} · Lote {seleccion.lote} · {seleccion.location}</p>
                <p className="mt-1">Cantidad: <b className="tabular-nums">{seleccion.cantidad}</b></p>
                <p className="mt-1">Motivo: {seleccion.motivo || "—"}</p>
                <p className="mt-1">Solicitó: {seleccion.solicitado_por}</p>
              </div>
              {accion === "rechazar" && (
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Motivo del rechazo</Label>
                  <Textarea value={motivoRechazo} onChange={(e) => setMotivoRechazo(e.target.value)} rows={2} className="mt-1" />
                </div>
              )}
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Tu clave de autorización (gerencia del proyecto)</Label>
                <Input type="password" value={clave} onChange={(e) => setClave(e.target.value)} className="mt-1" placeholder="••••" autoComplete="off" />
                <div className="mt-1">
                  <AyudaClaveAutorizacion />
                </div>
              </div>
              {accion === "aprobar" && (
                <p className="text-xs font-medium" style={{ color: "#C0392B" }}>
                  Al aprobar, el ajuste se aplica de inmediato al inventario real (invtrans) — no se puede deshacer desde aquí.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={cerrarDialogo}>Cancelar</Button>
            <Button
              onClick={confirmar}
              disabled={enviando || !clave.trim() || (accion === "rechazar" && !motivoRechazo.trim())}
            >
              {enviando ? "Enviando…" : accion === "aprobar" ? "Aprobar" : "Rechazar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pestaña 5 — Guía / Capacitación (misma fuente que usa LIPbot)
// ---------------------------------------------------------------------------

function GuiaTransacciones() {
  const [busqueda, setBusqueda] = useState("")
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return GUIA_TRANSACCIONES
    return GUIA_TRANSACCIONES.filter(
      (g) => g.codigo.includes(q) || g.nombre.toLowerCase().includes(q) || g.cuandoUsar.toLowerCase().includes(q) || g.ejemplo.toLowerCase().includes(q),
    )
  }, [busqueda])

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <p className="font-semibold">Cómo funciona este módulo</p>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>En <b>Movimiento por código</b> escribes el código de la transacción y el sistema habilita SOLO los campos de ese movimiento. La nomenclatura está siempre visible al lado.</li>
          <li>Puedes trabajar <b>Sin QR</b> (eliges ubicación, producto y lote manualmente) o <b>Con QR</b> (escaneas la estiba y los campos se precargan) — conviven porque aún no todas las estibas tienen QR.</li>
          <li>Los códigos de <b>corrección</b> (con el escudo <ShieldCheck className="inline h-3.5 w-3.5" />) exigen <b>motivo + clave del responsable</b>. Los movimientos normales quedan libres.</li>
          <li>Los <b>reversos</b> (102, 602, 552, 312) piden buscar y elegir el movimiento original; el sistema muestra cuánto queda <b>reversible</b> y no deja pasar de ahí.</li>
          <li>Todo lo ejecutado queda con <b>quién lo hizo, quién autorizó y por qué</b> en el <b>Historial de correcciones</b> — revisable y exportable, sin riesgo para el inventario.</li>
          <li>En <b>Consulta de movimientos</b> puedes ver cualquier movimiento por rango de fechas (desde–hasta) y exportarlo a Excel.</li>
          <li>¿Dudas en vivo? Pregúntale a <b>LIPbot</b> — conoce esta guía y te direcciona la transacción correcta paso a paso.</li>
        </ul>
      </Card>

      <Input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar transacción… (ej: lote, reverso, cuarentena)" className="max-w-md" />

      <div className="grid gap-3 md:grid-cols-2">
        {filtradas.map((g) => (
          <Card key={g.codigo} className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-sm font-bold">{g.codigo}</Badge>
              <p className="font-semibold">{g.nombre}</p>
              {FIELDSETS[g.codigo]?.requiereClave && (
                <Badge variant="outline" className="ml-auto gap-1 text-[10px]" style={{ color: "#C0392B", borderColor: "#C0392B" }}>
                  <ShieldCheck className="h-3 w-3" /> Clave
                </Badge>
              )}
            </div>
            <p className="text-sm"><span className="font-medium">Cuándo usarlo:</span> {g.cuandoUsar}</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
              {g.pasos.map((p, i) => <li key={i}>{p}</li>)}
            </ol>
            <p className="rounded-md bg-muted/40 px-3 py-2 text-xs"><span className="font-medium">Ejemplo:</span> {g.ejemplo}</p>
            {g.advertencia && <p className="text-xs" style={{ color: "#C0392B" }}>⚠ {g.advertencia}</p>}
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Wrapper del módulo
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cuarentena (calidad): stock BLOQUEADO del proyecto. Sigue siendo inventario
// (se ve y se valora), pero no está disponible para despacho: picking lo
// rechaza. Sale con 343 (liberar, clave de la gerencia del proyecto) o 555
// (desecho, aprobación de esa misma gerencia). Equivale al stock bloqueado de
// SAP (mov. 344/343/555). Ver scripts/202_cuarentena_calidad.sql.
// ---------------------------------------------------------------------------
function StockCuarentena() {
  const { selectedEmpresaId } = useAuth()
  const [filas, setFilas] = useState<StockCuarentenaRow[]>([])
  const [ubicacion, setUbicacion] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const cargar = async () => {
    if (!selectedEmpresaId) return
    setCargando(true)
    const r = await getStockCuarentena(Number(selectedEmpresaId))
    setFilas(r.data)
    setUbicacion(r.ubicacion)
    setAviso(r.message ?? null)
    setCargando(false)
  }
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const total = filas.reduce((s, f) => s + f.stock_actual, 0)

  return (
    <div className="space-y-3">
      <Card className="p-3 text-sm text-muted-foreground">
        Producto <b>bloqueado por calidad</b> (contaminado, vencido, húmedo, con plaga, no conforme). Sigue en el inventario
        pero <b>no está disponible</b>: el picking lo rechaza. Se bloquea con <b>344</b> (sin clave), se libera con <b>343</b>{" "}
        (clave de la gerencia del proyecto) o se desecha con <b>555</b> (queda en Aprobaciones pendientes hasta que esa
        gerencia lo apruebe). Nunca se usa 702 para calidad: 702 es solo diferencia de conteo.
        {ubicacion && <span className="ml-1">Ubicación: <b>{ubicacion}</b>.</span>}
      </Card>
      {aviso && <Card className="p-3 text-sm text-amber-800 bg-amber-50 border-amber-300">{aviso}</Card>}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">
            {filas.length} lote{filas.length !== 1 ? "s" : ""} bloqueado{filas.length !== 1 ? "s" : ""} · {total.toLocaleString("es-CO")} und
          </span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={cargar} disabled={cargando}>
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Actualizar"}
          </Button>
        </div>
        <div className="max-h-[65vh] overflow-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-2 py-2">Producto</th>
                <th className="px-2 py-2">Lote</th>
                <th className="px-2 py-2 text-right">Bloqueado (und)</th>
                <th className="px-2 py-2">Desde</th>
                <th className="px-2 py-2 text-right">Días</th>
                <th className="px-2 py-2">Motivo del bloqueo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.producto}|${f.lote}`} className="border-b last:border-0 align-top">
                  <td className="px-2 py-1.5 text-xs">
                    {f.producto}
                    {f.codproducto && <span className="ml-1 text-muted-foreground">({f.codproducto})</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs">{f.lote}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.stock_actual.toLocaleString("es-CO")}</td>
                  <td className="px-2 py-1.5 text-xs">{f.bloqueado_desde ? fmtFechaHora(f.bloqueado_desde) : "—"}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums text-xs ${(f.dias_bloqueado ?? 0) > 15 ? "font-semibold text-red-600" : ""}`}>
                    {f.dias_bloqueado ?? "—"}
                  </td>
                  <td className="max-w-[260px] px-2 py-1.5 text-xs text-muted-foreground">{f.motivo_bloqueo || "—"}</td>
                </tr>
              ))}
              {!cargando && filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No hay producto bloqueado en cuarentena en este proyecto.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

export function InventoryTransactionsModule() {
  const [tab, setTab] = useState("codigo")
  const tabs = useMemo(
    () => [
      { v: "codigo", l: "Movimiento por código" },
      { v: "clasico", l: "Formulario clásico" },
      { v: "consulta", l: "Consulta de movimientos" },
      { v: "historial", l: "Historial de correcciones" },
      { v: "aprobaciones", l: "Aprobaciones pendientes" },
      { v: "cuarentena", l: "Cuarentena (calidad)" },
      { v: "guia", l: "Guía" },
    ],
    [],
  )
  return (
    <div className="space-y-4 p-1">
      <div>
        <h1 className="text-2xl font-bold">Transacciones de Inventario</h1>
        <p className="text-sm text-muted-foreground">
          Escribe el código de la transacción (estilo SAP) y el sistema habilita los campos del movimiento. Todo queda trazado: quién, cuándo, qué y por qué.
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {tabs.map((t) => <TabsTrigger key={t.v} value={t.v}>{t.l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="codigo" className="pt-3"><TransaccionesPorCodigo /></TabsContent>
        <TabsContent value="clasico" className="pt-3"><InventoryTransactionsForm /></TabsContent>
        <TabsContent value="consulta" className="pt-3"><ConsultaMovimientos /></TabsContent>
        <TabsContent value="historial" className="pt-3"><HistorialCorrecciones /></TabsContent>
        <TabsContent value="aprobaciones" className="pt-3"><AprobacionesPendientes /></TabsContent>
        <TabsContent value="cuarentena" className="pt-3"><StockCuarentena /></TabsContent>
        <TabsContent value="guia" className="pt-3"><GuiaTransacciones /></TabsContent>
      </Tabs>
    </div>
  )
}
