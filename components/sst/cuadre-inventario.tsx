"use client"

// SIG — Cuadre / Conteo Físico de Inventario (LIPgo).
// Persiste el conteo físico vs sistema (saldoinvdetalle), documenta diferencias
// y genera ajustes contabilizados. Por cliente/sitio. Evidencia ISO 8.5.1.

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import {
  getCuadres,
  getCuadreDetalle,
  crearCuadre,
  guardarLineaConteoCuadre,
  cerrarCuadre,
  cerrarMesCuadre,
  firmarCuadre,
  eliminarCuadre,
  generarAjustesCuadre,
  getAjustesInventario,
  registrarAjusteInventario,
  eliminarAjusteInventario,
  aprobarAjusteInventario,
  getProductosInventario,
  getTiposMovimiento,
} from "@/lib/sig-actions"
import { useAuth } from "@/components/auth-provider"
import { SigHeader, SigFilterBar, SigKpi } from "@/components/sst/sig-ui"
import { SignaturePad, type SignaturePadHandle } from "@/components/rrhh/signature-pad"
import type { SigInventarioCuadre, SigInventarioCuadreDetalle, SigInventarioAjuste } from "@/lib/sig-types"
import { Loader2, ClipboardCheck, Plus, Lock, Trash2, FileCheck2, ArrowLeft, Pencil, BookOpen, CheckCircle2, ArrowDownToLine, ArrowUpFromLine, PackageSearch, User, ChevronDown, ChevronRight } from "lucide-react"

const ESTADO_CUADRE: Record<string, { label: string; color: string }> = {
  borrador: { label: "Borrador", color: "#94a3b8" },
  contado: { label: "Contado", color: SST_TOKENS.warn },
  cerrado: { label: "Cerrado", color: SST_TOKENS.navy },
  aprobado: { label: "Aprobado", color: SST_TOKENS.ok },
}

// Tipos de ajuste con su dirección natural y código de transacción (nomenclatura).
const TIPO_AJUSTE = [
  { v: "sobrante", l: "Sobrante", codigo: "701", dir: "ingreso" },
  { v: "devolucion", l: "Devolución / reingreso", codigo: "101", dir: "ingreso" },
  { v: "faltante", l: "Faltante", codigo: "702", dir: "salida" },
  { v: "averia", l: "Avería / merma", codigo: "551", dir: "salida" },
  { v: "correccion", l: "Corrección", codigo: "701/702", dir: "ambos" },
]

// Código de transacción resultante a partir del tipo + dirección.
/** "mié. 30 sep" del día anterior a una fecha 'YYYY-MM-DD' (el corte del conteo total). */
function fechaAnteriorTexto(fechaISO: string): string {
  const [y, m, d] = fechaISO.slice(0, 10).split("-").map(Number)
  if (!y || !m || !d) return "ayer"
  const ant = new Date(Date.UTC(y, m - 1, d - 1, 12))
  return ant.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}

function codigoDe(tipo: string, direccion: string): string {
  const t = TIPO_AJUSTE.find((x) => x.v === tipo)
  if (!t) return ""
  if (t.v === "correccion") return direccion === "salida" ? "702" : "701"
  return t.codigo
}

export function CuadreInventario() {
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre, user, profile } = useAuth()
  const proyecto = selectedEmpresaId ? String(selectedEmpresaId) : "" // lo define el selector global
  // Usuario que realiza la transacción (auditoría).
  const actor = (profile as any)?.nombre || (profile as any)?.usuario || user?.email || "usuario LIPgo"
  const [cuadres, setCuadres] = useState<SigInventarioCuadre[]>([])
  const [ajustes, setAjustes] = useState<SigInventarioAjuste[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<SigInventarioCuadre | null>(null)
  const [detalle, setDetalle] = useState<SigInventarioCuadreDetalle[]>([])
  const [loadingDet, setLoadingDet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nuevo, setNuevo] = useState<{ fecha: string; tipo: string; responsable: string; modo: "todos" | "producto"; codproducto: string } | null>(null)
  const [formAjuste, setFormAjuste] = useState<any | null>(null)
  const [firma, setFirma] = useState<{ firmante: string; cargo: string; fecha: string; obs: string }>({ firmante: "", cargo: "", fecha: "", obs: "" })
  const [tiposMov, setTiposMov] = useState<any[]>([])
  const [verNom, setVerNom] = useState(false)
  const [productos, setProductos] = useState<any[]>([]) // catálogo para precargar el ajuste
  // Conteo concurrente: cada línea se guarda sola al perder foco (autosave),
  // sin tocar las demás — así varias personas cuentan el mismo documento sin
  // pisarse el trabajo. dirtyRef marca qué líneas cambiaron desde el último
  // guardado; detalleRef evita cerrar sobre un valor viejo en el onBlur.
  const [savingLineId, setSavingLineId] = useState<number | null>(null)
  const dirtyRef = useRef<Set<number>>(new Set())
  const detalleRef = useRef<SigInventarioCuadreDetalle[]>([])
  useEffect(() => { detalleRef.current = detalle }, [detalle])
  const [gruposColapsados, setGruposColapsados] = useState<Set<string>>(new Set())
  const firmaPadRef = useRef<SignaturePadHandle | null>(null)

  async function abrirNomenclatura() {
    setVerNom(true)
    if (tiposMov.length === 0) { const r = await getTiposMovimiento(); if (r.success) setTiposMov(r.data) }
  }

  async function cargar() {
    if (!proyecto) {
      setCuadres([])
      setAjustes([])
      return
    }
    setLoading(true)
    const pid = Number(proyecto)
    const [c, a, p] = await Promise.all([getCuadres(pid), getAjustesInventario(pid), getProductosInventario(pid)])
    if (c.success) setCuadres(c.data)
    if (a.success) setAjustes(a.data)
    if (p.success) setProductos(p.data)
    setLoading(false)
  }
  useEffect(() => {
    cargar()
    setSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyecto])

  async function abrir(c: SigInventarioCuadre) {
    setSel(c)
    setFirma({
      firmante: c.cliente_firmante ?? "",
      cargo: c.cliente_cargo ?? "",
      fecha: c.fecha_firma ?? "",
      obs: c.acta_observaciones ?? "",
    })
    setLoadingDet(true)
    const r = await getCuadreDetalle(c.id)
    if (r.success) setDetalle(r.data)
    else toast({ title: "No se pudo cargar el detalle", description: r.error })
    setLoadingDet(false)
  }

  async function guardarFirma() {
    if (!sel) return
    if (!firma.firmante.trim()) { toast({ title: "Indica quién firma por el cliente" }); return }
    if (!firmaPadRef.current || firmaPadRef.current.isEmpty()) { toast({ title: "Falta la firma", description: "Dibuje la firma para cerrar el acta." }); return }
    setSaving(true)
    try {
      const blob = await firmaPadRef.current.toBlob()
      let firmaUrl: string | null = null
      if (blob) {
        const fd = new FormData()
        fd.append("file", blob, `firma-cuadre-${sel.id}.png`)
        const up = await fetch("/api/capacitaciones/upload-firma", { method: "POST", body: fd })
        const upJson = await up.json()
        if (!upJson?.url) throw new Error(upJson?.error || "No se pudo subir la firma")
        firmaUrl = upJson.url
      }
      const r = await firmarCuadre(sel.id, {
        cliente_firmante: firma.firmante,
        cliente_cargo: firma.cargo,
        fecha_firma: firma.fecha || null,
        acta_observaciones: firma.obs,
        firma_url: firmaUrl,
      })
      if (!r.success) throw new Error(r.error || "No se pudo guardar la firma")
      toast({ title: "Acta firmada" })
      await cargar()
      setSel({ ...sel, cliente_firmante: firma.firmante, cliente_cargo: firma.cargo, fecha_firma: firma.fecha || null, acta_observaciones: firma.obs, firmado: true, firma_url: firmaUrl })
    } catch (e: any) {
      toast({ title: "No se pudo guardar la firma", description: e?.message || "Error desconocido" })
    } finally {
      setSaving(false)
    }
  }

  async function generarActaPDF() {
    if (!sel) return
    const { default: jsPDF } = await import("jspdf")
    const autoTable = (await import("jspdf-autotable")).default
    const doc = new jsPDF()
    const fmtN = (n: any) => (Number(n) || 0).toLocaleString("es-CO")
    doc.setFontSize(14); doc.text("ACTA DE REVISIÓN DE INVENTARIO", 14, 18)
    doc.setFontSize(10)
    doc.text(`Cliente / sitio: ${selectedEmpresaNombre || "—"}`, 14, 27)
    doc.text(`Documento de conteo: #${sel.id}    Fecha: ${sel.fecha ?? ""}    Tipo: ${sel.tipo ?? ""}`, 14, 33)
    doc.text(`Responsable LIP: ${sel.responsable ?? ""}`, 14, 39)
    autoTable(doc, {
      startY: 45,
      head: [["Concepto", "Valor"]],
      body: [
        ["Stock sistema (libro)", fmtN(sel.total_sistema)],
        ["Conteo físico", fmtN(sel.total_conteo)],
        ["Diferencia", fmtN(sel.total_diferencia)],
        ["Ítems contados", fmtN(sel.items)],
        ["Ítems con diferencia", fmtN(sel.items_con_diferencia)],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [13, 59, 110] },
    })
    const difs = detalle.filter((d) => (Number(d.diferencia) || 0) !== 0)
    let y = (doc as any).lastAutoTable.finalY + 8
    if (difs.length > 0) {
      doc.text("Ítems con diferencia:", 14, y)
      autoTable(doc, {
        startY: y + 3,
        head: [["Producto", "Lote", "Sistema", "Conteo", "Diferencia"]],
        body: difs.slice(0, 40).map((d) => [d.producto ?? "", d.lote ?? "", fmtN(d.sistema), fmtN(d.conteo), fmtN(d.diferencia)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [13, 59, 110] },
      })
      y = (doc as any).lastAutoTable.finalY + 8
    }
    if (sel.acta_observaciones) { doc.setFontSize(9); doc.text(`Observaciones: ${sel.acta_observaciones}`, 14, y); y += 8 }
    // Firmas
    y = Math.max(y, 230)
    doc.setFontSize(10)
    doc.line(20, y, 90, y); doc.line(120, y, 190, y)
    doc.text("Firma Cliente", 35, y + 5); doc.text("Firma LIP", 145, y + 5)
    doc.setFontSize(8)
    doc.text(`${sel.cliente_firmante ?? ""}  ${sel.cliente_cargo ? "(" + sel.cliente_cargo + ")" : ""}`, 20, y + 11)
    doc.text(`Fecha: ${sel.fecha_firma ?? ""}`, 20, y + 16)
    doc.text(`${sel.responsable ?? ""}`, 120, y + 11)
    doc.save(`Acta_Inventario_${selectedEmpresaNombre || "cliente"}_${sel.fecha ?? sel.id}.pdf`)
  }

  async function crear() {
    if (!nuevo) return
    if (nuevo.modo === "producto" && !nuevo.codproducto.trim()) {
      toast({ title: "Selecciona el producto a contar" })
      return
    }
    setSaving(true)
    const r = await crearCuadre(Number(proyecto), {
      fecha: nuevo.fecha || undefined,
      tipo: nuevo.tipo,
      responsable: nuevo.responsable,
      creado_por: actor,
      codproductoUnico: nuevo.modo === "producto" ? nuevo.codproducto.trim() : undefined,
    })
    setSaving(false)
    if (r.success) {
      toast({ title: "Conteo creado", description: `${r.items} ítems cargados desde el sistema` })
      setNuevo(null)
      await cargar()
    } else toast({ title: "No se pudo crear", description: r.error })
  }

  function setConteo(id: number, v: string) {
    const n = Number(v)
    dirtyRef.current.add(id)
    setDetalle((prev) => prev.map((d) => (d.id === id ? { ...d, conteo: isNaN(n) ? 0 : n, diferencia: (isNaN(n) ? 0 : n) - (d.sistema ?? 0) } : d)))
  }

  // Guarda SOLO esta línea (upsert) al perder el foco — no toca las demás,
  // por eso varias personas pueden contar el mismo documento a la vez.
  async function guardarLinea(id: number) {
    if (!sel || !dirtyRef.current.has(id)) return
    const d = detalleRef.current.find((x) => x.id === id)
    if (!d) return
    dirtyRef.current.delete(id)
    setSavingLineId(id)
    const r = await guardarLineaConteoCuadre(
      sel.id,
      {
        codproducto: d.codproducto,
        producto: d.producto,
        lote: d.lote,
        location: d.location,
        sistema: d.sistema ?? 0,
        conteo: d.conteo ?? 0,
        observacion: d.observacion,
      },
      actor,
    )
    setSavingLineId(null)
    if (r.success) {
      const ahora = new Date().toISOString()
      setDetalle((prev) => prev.map((x) => (x.id === id ? { ...x, contado_por: actor, contado_en: ahora } : x)))
      if (sel.estado !== "contado") setSel((prev) => (prev ? { ...prev, estado: "contado" } : prev))
    } else {
      dirtyRef.current.add(id) // no se pudo guardar — reintenta en el próximo blur
      toast({ title: "No se pudo guardar el conteo de esta línea", description: r.error })
    }
  }

  function toggleGrupo(key: string) {
    setGruposColapsados((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function generar() {
    if (!sel) return
    if (!confirm("¿Generar ajustes contabilizados desde las diferencias de este conteo?")) return
    const r = await generarAjustesCuadre(sel.id)
    if (r.success) {
      toast({ title: "Ajustes generados", description: `${r.creados} ajustes creados` })
      await cargar()
      setSel(null)
    } else toast({ title: "No se pudo", description: r.error })
  }

  async function cerrar(estado: string) {
    if (!sel) return
    const r = await cerrarCuadre(sel.id, estado)
    if (r.success) {
      toast({ title: `Cuadre ${estado}` })
      await cargar()
      setSel({ ...sel, estado })
    } else toast({ title: "No se pudo", description: r.error })
  }

  // Cierre mensual: postea TODAS las correcciones a invtrans (mueve stock real)
  // y marca el cuadre como aprobado. Hacer después de firmar el Acta.
  async function cerrarMes() {
    if (!sel) return
    if (!confirm("CIERRE MENSUAL\n\nSe contabilizarán las correcciones del cuadre como movimientos reales de inventario (mueven el stock: faltantes salen, sobrantes entran) y el saldo del sistema quedará igual al conteo físico. Esta acción no se puede deshacer.\n\n¿Cerrar el mes?")) return
    setSaving(true)
    const r = await cerrarMesCuadre(sel.id, actor)
    setSaving(false)
    if (r.success) {
      toast({ title: "Mes cerrado", description: `${r.posteados ?? 0} correcciones contabilizadas · stock ajustado` })
      await cargar()
      setSel({ ...sel, estado: "aprobado" })
    } else toast({ title: "No se pudo cerrar el mes", description: r.error })
  }

  async function borrarCuadre(c: SigInventarioCuadre) {
    if (!confirm("¿Eliminar este conteo?")) return
    const r = await eliminarCuadre(c.id)
    if (r.success) { cargar(); if (sel?.id === c.id) setSel(null) }
    else toast({ title: "No se pudo eliminar", description: r.error })
  }

  async function guardarAjuste() {
    if (!formAjuste) return
    if (!formAjuste.codproducto) { toast({ title: "Digita el código de producto" }); return }
    if (!Number(formAjuste.cantidad)) { toast({ title: "Indica la cantidad" }); return }
    const direccion = formAjuste.direccion || (TIPO_AJUSTE.find((t) => t.v === formAjuste.tipo)?.dir === "salida" ? "salida" : "ingreso")
    setSaving(true)
    const r = await registrarAjusteInventario(Number(proyecto), {
      ...formAjuste,
      direccion,
      cod_movimiento: codigoDe(formAjuste.tipo, direccion),
      cantidad: Math.abs(Number(formAjuste.cantidad) || 0),
      responsable: formAjuste.responsable || actor,
    })
    setSaving(false)
    if (r.success) {
      toast({ title: formAjuste.id ? "Ajuste actualizado" : "Ajuste registrado" })
      setFormAjuste(null)
      cargar()
    } else toast({ title: "No se pudo", description: r.error })
  }
  async function borrarAjuste(a: SigInventarioAjuste) {
    if (!confirm("¿Eliminar este ajuste?")) return
    const r = await eliminarAjusteInventario(a.id)
    if (r.success) cargar()
    else toast({ title: "No se pudo eliminar", description: r.error })
  }
  async function aprobar(a: SigInventarioAjuste) {
    const signo = (a.cantidad ?? 0) < 0 ? "salida (descuenta stock)" : "entrada (suma stock)"
    if (!confirm(`Aprobar y CONTABILIZAR la corrección de ${a.producto || a.codproducto}.\n\nSe generará un movimiento real de ${signo} en el inventario (mueve el saldo). Aprobado por ${actor}.\n\n¿Continuar?`)) return
    const r = await aprobarAjusteInventario(a.id, actor)
    if (r.success) { toast({ title: "Corrección contabilizada", description: "Stock ajustado" }); cargar() }
    else toast({ title: "No se pudo aprobar", description: r.error })
  }

  // Producto seleccionado en el formulario de ajuste (precarga).
  const prodSel = useMemo(
    () => (formAjuste?.codproducto ? productos.find((p) => p.codproducto === formAjuste.codproducto) : null),
    [formAjuste?.codproducto, productos],
  )
  // Stock de referencia para el lote/ubicación elegidos (valida la salida).
  const stockRef = useMemo(() => {
    if (!prodSel) return null
    const filas = (prodSel.porUbicacion || []).filter(
      (u: any) => (!formAjuste?.lote || u.lote === formAjuste.lote) && (!formAjuste?.location || u.location === formAjuste.location),
    )
    if (filas.length === 0) return prodSel.stock
    return filas.reduce((s: number, u: any) => s + (Number(u.stock) || 0), 0)
  }, [prodSel, formAjuste?.lote, formAjuste?.location])

  // Indicadores de ajustes (control y aprobación).
  const indAj = useMemo(() => {
    const total = ajustes.length
    const pendientes = ajustes.filter((a) => (a.estado ?? "registrado") !== "aprobado").length
    const aprobados = total - pendientes
    let faltante = 0, sobrante = 0
    for (const a of ajustes) {
      const c = Number(a.cantidad) || 0
      if (c < 0) faltante += Math.abs(c)
      else sobrante += c
    }
    return { total, pendientes, aprobados, faltante, sobrante }
  }, [ajustes])

  const fmt = (n: any) => (Number(n) || 0).toLocaleString("es-CO")
  const difTotal = useMemo(() => detalle.reduce((s, d) => s + (Number(d.diferencia) || 0), 0), [detalle])
  const conDif = useMemo(() => detalle.filter((d) => (Number(d.diferencia) || 0) !== 0).length, [detalle])

  // Agrupa el detalle por producto: cantidad por lote (filas) + cantidad total (subtotal).
  const grupos = useMemo(() => {
    const map = new Map<
      string,
      { key: string; producto: string; codproducto: string | null; sistema: number; conteo: number; diferencia: number; filas: SigInventarioCuadreDetalle[] }
    >()
    for (const d of detalle) {
      const key = d.codproducto || d.producto || "—"
      let g = map.get(key)
      if (!g) {
        g = { key, producto: d.producto || d.codproducto || "—", codproducto: d.codproducto, sistema: 0, conteo: 0, diferencia: 0, filas: [] }
        map.set(key, g)
      }
      g.sistema += Number(d.sistema) || 0
      g.conteo += Number(d.conteo) || 0
      g.diferencia += Number(d.diferencia) || 0
      g.filas.push(d)
    }
    return Array.from(map.values()).sort((a, b) => a.producto.localeCompare(b.producto))
  }, [detalle])

  // ---------- Vista DETALLE de un cuadre ----------
  if (sel) {
    const est = ESTADO_CUADRE[sel.estado ?? "borrador"] ?? ESTADO_CUADRE.borrador
    const editable = sel.estado === "borrador" || sel.estado === "contado"
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Volver
            </Button>
            <h2 className="text-lg font-bold" style={{ color: SST_TOKENS.ink }}>
              Conteo #{sel.id} · {sel.fecha}
            </h2>
            <Badge style={{ background: est.color, color: "white" }}>{est.label}</Badge>
            {sel.creado_por && <span className="text-xs text-muted-foreground">por {sel.creado_por}</span>}
          </div>
          <div className="flex gap-2">
            {editable && (
              <span className="self-center text-[11px] text-muted-foreground">
                Cada línea se guarda sola al contarla — varias personas pueden contar a la vez sin pisarse.
              </span>
            )}
            {(sel.estado === "contado") && (
              <Button size="sm" onClick={generar} style={{ background: SST_TOKENS.navy, color: "white" }}>
                <FileCheck2 className="mr-1 h-4 w-4" /> Generar correcciones
              </Button>
            )}
            {sel.estado === "cerrado" && (
              <Button size="sm" disabled={saving} onClick={cerrarMes} style={{ background: SST_TOKENS.ok, color: "white" }}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />} Cerrar mes (ajusta stock)
              </Button>
            )}
            {sel.estado === "aprobado" && (
              <Badge style={{ background: SST_TOKENS.ok, color: "white" }} className="self-center">Mes cerrado · stock ajustado</Badge>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SigKpi label="Sistema" value={fmt(sel.total_sistema)} accent={SST_TOKENS.navy} />
          <SigKpi label="Conteo físico" value={fmt(detalle.reduce((s, d) => s + (Number(d.conteo) || 0), 0))} accent={SST_TOKENS.navy} />
          <SigKpi label="Diferencia" value={fmt(difTotal)} accent={difTotal === 0 ? SST_TOKENS.ok : SST_TOKENS.bad} valueColor={difTotal === 0 ? SST_TOKENS.ok : SST_TOKENS.bad} />
          <SigKpi label="Ítems con diferencia" value={conDif} accent={conDif ? SST_TOKENS.bad : SST_TOKENS.ok} valueColor={conDif ? SST_TOKENS.bad : SST_TOKENS.ok} />
        </div>

        <Card className="overflow-hidden">
          {loadingDet ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="max-h-[55vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Lote</th>
                    <th className="px-3 py-2">Ubic.</th>
                    <th className="px-3 py-2 text-right">Sistema</th>
                    <th className="px-3 py-2 text-right">Conteo</th>
                    <th className="px-3 py-2 text-right">Diferencia</th>
                    <th className="px-3 py-2">Contado por</th>
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => {
                    const colapsado = gruposColapsados.has(g.key)
                    const gDif = Math.round(g.diferencia * 100) / 100
                    const contadas = g.filas.filter((f) => f.contado_por).length
                    return (
                      <Fragment key={g.key}>
                        <tr className="cursor-pointer select-none border-b bg-muted/40 hover:bg-muted/60" onClick={() => toggleGrupo(g.key)}>
                          <td className="px-3 py-1.5 font-semibold" colSpan={3}>
                            <span className="inline-flex items-center gap-1">
                              {colapsado ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              {g.producto}
                              {g.codproducto && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· {g.codproducto}</span>}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(g.sistema)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(g.conteo)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold" style={{ color: gDif === 0 ? undefined : gDif > 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                            {gDif > 0 ? "+" : ""}{fmt(gDif)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">{contadas}/{g.filas.length} líneas</td>
                        </tr>
                        {!colapsado && g.filas.map((d) => {
                          const dif = Number(d.diferencia) || 0
                          return (
                            <tr key={d.id} className={`border-b last:border-0 ${dif !== 0 ? "bg-red-50" : ""}`}>
                              <td className="px-3 py-1.5"></td>
                              <td className="px-3 py-1.5 text-muted-foreground">{d.lote || "—"}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{d.location || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{fmt(d.sistema)}</td>
                              <td className="px-3 py-1.5 text-right">
                                {editable ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <Input
                                      type="number"
                                      value={d.conteo ?? 0}
                                      onChange={(e) => setConteo(d.id, e.target.value)}
                                      onBlur={() => guardarLinea(d.id)}
                                      className="h-7 w-24 text-right"
                                    />
                                    {savingLineId === d.id && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                                  </span>
                                ) : (
                                  fmt(d.conteo)
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-right font-medium" style={{ color: dif === 0 ? undefined : dif > 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                                {dif > 0 ? "+" : ""}{fmt(dif)}
                              </td>
                              <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                                {d.contado_por ? (
                                  <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{d.contado_por}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ACTA DE REVISIÓN DE INVENTARIO — firma del cliente (auditoría) */}
        <Card className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>
              Acta de Revisión de Inventario — Firma del cliente
              {sel.firmado && <Badge className="ml-2" style={{ background: SST_TOKENS.ok, color: "white" }}>Firmada</Badge>}
            </h3>
            <Button size="sm" variant="outline" onClick={generarActaPDF}>
              <FileCheck2 className="mr-1 h-4 w-4" /> Generar Acta (PDF)
            </Button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Para auditoría: el cliente firma cada 1 de mes que se realizó el inventario. Este conteo firmado queda como el inventario inicial del mes siguiente.
          </p>
          <div className="grid gap-2 md:grid-cols-3">
            <Input value={firma.firmante} onChange={(e) => setFirma({ ...firma, firmante: e.target.value })} placeholder="Quién firma (cliente)" />
            <Input value={firma.cargo} onChange={(e) => setFirma({ ...firma, cargo: e.target.value })} placeholder="Cargo" />
            <DatePickerField value={firma.fecha} onChange={(value) => setFirma({ ...firma, fecha: value })} />
          </div>
          <Input className="mt-2" value={firma.obs} onChange={(e) => setFirma({ ...firma, obs: e.target.value })} placeholder="Observaciones del acta" />
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-start">
            {sel.firmado && sel.firma_url ? (
              <div className="flex flex-col items-start gap-1">
                <span className="text-[11px] text-muted-foreground">Firma registrada:</span>
                <img src={sel.firma_url} alt="Firma" className="h-16 rounded-md border bg-white p-1" />
              </div>
            ) : (
              <SignaturePad ref={firmaPadRef} height={140} className="w-full max-w-sm" />
            )}
            <Button size="sm" disabled={saving} onClick={guardarFirma}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : sel.firmado ? "Actualizar firma" : "Guardar firma"}
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  // ---------- Vista LISTA ----------
  return (
    <div className="space-y-5">
      <SigHeader
        Icon={ClipboardCheck}
        title="Cuadre y Correcciones de Inventario"
        subtitle="Conteo físico vs sistema → correcciones que ajustan el stock → cierre mensual con acta · por cliente/sitio"
      />

      <SigFilterBar cliente={selectedEmpresaNombre}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" style={{ color: SST_TOKENS.teal }} />}
      </SigFilterBar>

      {!proyecto ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Selecciona un cliente/sitio en el selector global para ver sus conteos y ajustes.</Card>
      ) : (
        <Tabs defaultValue="cuadres">
          <TabsList>
            <TabsTrigger value="cuadres">Conteos / Cierres ({cuadres.length})</TabsTrigger>
            <TabsTrigger value="ajustes">Correcciones ({ajustes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="cuadres" className="space-y-3 pt-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setNuevo({ fecha: "", tipo: "total", responsable: "", modo: "todos", codproducto: "" })}>
                <Plus className="mr-2 h-4 w-4" /> Nuevo conteo físico
              </Button>
            </div>
            {cuadres.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Sin conteos registrados.</Card>
            ) : (
              <div className="space-y-2">
                {cuadres.map((c) => {
                  const est = ESTADO_CUADRE[c.estado ?? "borrador"] ?? ESTADO_CUADRE.borrador
                  return (
                    <Card key={c.id} className="group flex items-center justify-between gap-3 p-3">
                      <button className="flex flex-1 items-center gap-3 text-left" onClick={() => abrir(c)}>
                        <span className="font-semibold" style={{ color: SST_TOKENS.ink }}>#{c.id}</span>
                        <span className="text-sm">{c.fecha}</span>
                        <Badge style={{ background: est.color, color: "white" }}>{est.label}</Badge>
                        <span className="text-xs text-muted-foreground">{c.items} ítems · {c.items_con_diferencia} con diferencia</span>
                        <span className="text-xs" style={{ color: (c.total_diferencia ?? 0) === 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                          dif: {fmt(c.total_diferencia)}
                        </span>
                      </button>
                      <button onClick={() => borrarCuadre(c)} className="text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="ajustes" className="space-y-3 pt-3">
            {/* Indicadores de ajustes — control y aprobación */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <SigKpi label="Correcciones" value={indAj.total} accent={SST_TOKENS.navy} />
              <SigKpi label="Pend. aprobar" value={indAj.pendientes} accent={indAj.pendientes ? SST_TOKENS.warn : SST_TOKENS.ok} valueColor={indAj.pendientes ? SST_TOKENS.warn : SST_TOKENS.ok} />
              <SigKpi label="Aprobadas" value={indAj.aprobados} accent={SST_TOKENS.ok} valueColor={SST_TOKENS.ok} />
              <SigKpi label="Faltante (−)" value={fmt(indAj.faltante)} accent={SST_TOKENS.bad} valueColor={SST_TOKENS.bad} />
              <SigKpi label="Sobrante (+)" value={fmt(indAj.sobrante)} accent={SST_TOKENS.ok} valueColor={SST_TOKENS.ok} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="outline" onClick={abrirNomenclatura}>
                <BookOpen className="mr-1 h-4 w-4" /> Tipos de movimiento (qué código usar)
              </Button>
              <Button size="sm" onClick={() => setFormAjuste({ fecha: "", direccion: "salida", tipo: "faltante", codproducto: "", producto: "", lote: "", location: "", cantidad: 0, motivo: "", responsable: actor, soporte: "" })}>
                <Plus className="mr-2 h-4 w-4" /> Registrar corrección
              </Button>
            </div>
            {ajustes.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Sin ajustes registrados.</Card>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Lote</th>
                      <th className="px-3 py-2">Ubic.</th>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-center">Cód.</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Responsable</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ajustes.map((a) => {
                      const aprobado = (a.estado ?? "registrado") === "aprobado"
                      return (
                        <tr key={a.id} className="group border-b last:border-0">
                          <td className="px-3 py-1.5 whitespace-nowrap">{a.fecha}</td>
                          <td className="px-3 py-1.5">
                            <div className="font-medium">{a.producto}</div>
                            {a.codproducto && <div className="text-[11px] text-muted-foreground">{a.codproducto}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.lote}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.location}</td>
                          <td className="px-3 py-1.5"><Badge variant="outline">{a.tipo}</Badge></td>
                          <td className="px-3 py-1.5 text-center"><Badge style={{ background: SST_TOKENS.navy, color: "white" }}>{a.cod_movimiento || "—"}</Badge></td>
                          <td className="px-3 py-1.5 text-right font-medium" style={{ color: (a.cantidad ?? 0) < 0 ? SST_TOKENS.bad : SST_TOKENS.ok }}>{(a.cantidad ?? 0) > 0 ? "+" : ""}{fmt(a.cantidad)}</td>
                          <td className="px-3 py-1.5">
                            {aprobado ? (
                              <Badge style={{ background: SST_TOKENS.ok, color: "white" }} title={`${a.aprobado_por ?? ""} ${a.aprobado_fecha ? "· " + String(a.aprobado_fecha).slice(0, 10) : ""}`}>Aprobado</Badge>
                            ) : (
                              <Badge style={{ background: SST_TOKENS.warn, color: "white" }}>Registrado</Badge>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-xs">{a.responsable || "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                              {!aprobado && <button onClick={() => aprobar(a)} title="Aprobar" className="text-muted-foreground hover:text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /></button>}
                              {!aprobado && <button onClick={() => setFormAjuste({ ...a })} title="Editar" className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                              <button onClick={() => borrarAjuste(a)} title="Eliminar" className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Dialog nuevo conteo */}
      <Dialog open={!!nuevo} onOpenChange={(o) => !o && setNuevo(null)}>
        <DialogContent className="max-w-md">
          {nuevo && (
            <>
              <DialogHeader><DialogTitle className="text-base">Nuevo conteo físico</DialogTitle></DialogHeader>
              <div className="space-y-2">
                {nuevo.tipo === "total" && nuevo.modo === "todos" ? (
                  <p className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
                    <span className="font-semibold">Conteo total (cierre de mes):</span> la fecha es el día del conteo. El sistema contra el que se
                    cuenta queda <span className="font-semibold">congelado al cierre del día anterior</span>
                    {nuevo.fecha ? ` (${fechaAnteriorTexto(nuevo.fecha)})` : " (ayer)"}, sin los movimientos del día: puedes crearlo aunque la operación ya haya empezado.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">Conteo cíclico: se carga el stock en vivo del sistema como base; luego capturas el conteo físico.</p>
                )}
                <DatePickerField value={nuevo.fecha} onChange={(value) => setNuevo({ ...nuevo, fecha: value })} />
                <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                  <option value="total">Conteo total</option>
                  <option value="ciclico">Conteo cíclico</option>
                </select>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={nuevo.modo === "todos" ? "default" : "outline"} className="flex-1" onClick={() => setNuevo({ ...nuevo, modo: "todos", codproducto: "" })}>
                    Todos los productos
                  </Button>
                  <Button type="button" size="sm" variant={nuevo.modo === "producto" ? "default" : "outline"} className="flex-1" onClick={() => setNuevo({ ...nuevo, modo: "producto" })}>
                    Un producto
                  </Button>
                </div>
                {nuevo.modo === "producto" && (
                  <div className="relative">
                    <PackageSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      list="prod-codigos-conteo"
                      value={nuevo.codproducto}
                      className="h-9 pl-8"
                      placeholder="Digita o selecciona el código del producto"
                      onChange={(e) => setNuevo({ ...nuevo, codproducto: e.target.value })}
                    />
                    <datalist id="prod-codigos-conteo">
                      {productos.map((p) => (<option key={p.codproducto} value={p.codproducto}>{p.nombreproducto}</option>))}
                    </datalist>
                  </div>
                )}
                <Input value={nuevo.responsable} onChange={(e) => setNuevo({ ...nuevo, responsable: e.target.value })} placeholder="Responsable" />
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setNuevo(null)}>Cancelar</Button>
                  <Button size="sm" disabled={saving} onClick={crear}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear"}</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog ajuste — formulario guiado con precarga */}
      <Dialog open={!!formAjuste} onOpenChange={(o) => !o && setFormAjuste(null)}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          {formAjuste && (
            <>
              <DialogHeader><DialogTitle className="text-base">{formAjuste.id ? "Editar" : "Registrar"} ajuste de inventario</DialogTitle></DialogHeader>
              <div className="space-y-3">
                {/* Paso 1 — Fecha + Dirección (ingreso / salida) */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="text-[11px] uppercase text-muted-foreground">Fecha</label>
                    <DatePickerField value={formAjuste.fecha ?? ""} onChange={(value) => setFormAjuste({ ...formAjuste, fecha: value })} className="h-9" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[11px] uppercase text-muted-foreground">Tipo de movimiento</label>
                    <div className="flex gap-2">
                      <Button type="button" variant={formAjuste.direccion === "ingreso" ? "default" : "outline"} size="sm" className="flex-1"
                        onClick={() => setFormAjuste({ ...formAjuste, direccion: "ingreso", tipo: "sobrante" })}>
                        <ArrowDownToLine className="mr-1 h-4 w-4" /> Ingreso
                      </Button>
                      <Button type="button" variant={formAjuste.direccion === "salida" ? "default" : "outline"} size="sm" className="flex-1"
                        onClick={() => setFormAjuste({ ...formAjuste, direccion: "salida", tipo: "faltante" })}>
                        <ArrowUpFromLine className="mr-1 h-4 w-4" /> Salida
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Paso 2 — Código de producto (precarga: digita el código y aparece el producto) */}
                <div>
                  <label className="text-[11px] uppercase text-muted-foreground">Código de producto</label>
                  <div className="relative">
                    <PackageSearch className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input list="prod-codigos" value={formAjuste.codproducto ?? ""} className="h-9 pl-8"
                      placeholder="Digita o selecciona el código"
                      onChange={(e) => {
                        const cod = e.target.value
                        const p = productos.find((x) => x.codproducto === cod)
                        setFormAjuste({ ...formAjuste, codproducto: cod, producto: p ? p.nombreproducto : formAjuste.producto, lote: "", location: "" })
                      }} />
                    <datalist id="prod-codigos">
                      {productos.map((p) => (<option key={p.codproducto} value={p.codproducto}>{p.nombreproducto}</option>))}
                    </datalist>
                  </div>
                  {prodSel ? (
                    <div className="mt-1 flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 text-xs">
                      <span className="font-medium">{prodSel.nombreproducto}</span>
                      <span className="text-muted-foreground">stock total: <b>{fmt(prodSel.stock)}</b></span>
                    </div>
                  ) : formAjuste.codproducto ? (
                    <p className="mt-1 text-[11px]" style={{ color: SST_TOKENS.warn }}>Código no encontrado en el inventario del cliente — verifica.</p>
                  ) : null}
                </div>

                {/* Paso 3 — Lote + Ubicación (respeta la configuración de LIPgo) */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] uppercase text-muted-foreground">Lote</label>
                    <Input list="prod-lotes" value={formAjuste.lote ?? ""} className="h-9" placeholder="Lote"
                      onChange={(e) => setFormAjuste({ ...formAjuste, lote: e.target.value })} />
                    <datalist id="prod-lotes">{(prodSel?.lotes || []).map((l: string) => (<option key={l} value={l} />))}</datalist>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase text-muted-foreground">Ubicación</label>
                    <Input list="prod-ubic" value={formAjuste.location ?? ""} className="h-9" placeholder="Ubicación"
                      onChange={(e) => setFormAjuste({ ...formAjuste, location: e.target.value })} />
                    <datalist id="prod-ubic">{(prodSel?.locations || []).map((l: string) => (<option key={l} value={l} />))}</datalist>
                  </div>
                </div>
                {prodSel && stockRef !== null && (
                  <div className="text-[11px] text-muted-foreground">
                    Stock en {formAjuste.lote || "todos los lotes"}{formAjuste.location ? ` · ${formAjuste.location}` : ""}: <b>{fmt(stockRef)}</b>
                    {formAjuste.direccion === "salida" && Number(formAjuste.cantidad) > Number(stockRef) && (
                      <span className="ml-1" style={{ color: SST_TOKENS.bad }}>· la salida supera el stock</span>
                    )}
                  </div>
                )}

                {/* Paso 4 — Tipo de ajuste + código de transacción (nomenclatura) */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] uppercase text-muted-foreground">Concepto del ajuste</label>
                    <select value={formAjuste.tipo} onChange={(e) => setFormAjuste({ ...formAjuste, tipo: e.target.value })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                      {TIPO_AJUSTE.filter((t) => t.dir === formAjuste.direccion || t.dir === "ambos").map((t) => (<option key={t.v} value={t.v}>{t.l}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] uppercase text-muted-foreground">Cantidad</label>
                    <Input type="number" min={0} value={formAjuste.cantidad ?? 0} className="h-9" placeholder="Cantidad"
                      onChange={(e) => setFormAjuste({ ...formAjuste, cantidad: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                  <span className="text-muted-foreground">Código de transacción:</span>
                  <Badge style={{ background: SST_TOKENS.navy, color: "white" }}>{codigoDe(formAjuste.tipo, formAjuste.direccion) || "—"}</Badge>
                  <button type="button" className="ml-auto text-[11px] underline text-muted-foreground hover:text-foreground" onClick={abrirNomenclatura}>ver nomenclatura</button>
                </div>

                {/* Paso 5 — Soporte / motivo / responsable */}
                <Input value={formAjuste.motivo ?? ""} onChange={(e) => setFormAjuste({ ...formAjuste, motivo: e.target.value })} placeholder="Motivo / justificación" className="h-9" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={formAjuste.soporte ?? ""} onChange={(e) => setFormAjuste({ ...formAjuste, soporte: e.target.value })} placeholder="Soporte (acta/doc)" className="h-9" />
                  <Input value={formAjuste.responsable ?? ""} onChange={(e) => setFormAjuste({ ...formAjuste, responsable: e.target.value })} placeholder="Responsable" className="h-9" />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setFormAjuste(null)}>Cancelar</Button>
                  <Button size="sm" disabled={saving} onClick={guardarAjuste}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* NOMENCLATURA — qué código de movimiento usar al ajustar */}
      <Dialog open={verNom} onOpenChange={setVerNom}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base">Tipos de movimiento (nomenclatura LIPgo)</DialogTitle></DialogHeader>
          <p className="mb-2 text-xs text-muted-foreground">Usa estos códigos al registrar un ajuste. Quedan reflejados en <b>invtrans.cod_movimiento</b> para identificar cada movimiento.</p>
          {tiposMov.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Corre el SQL 17 para cargar el catálogo.</p>
          ) : (
            <div className="space-y-2">
              {tiposMov.map((t) => (
                <div key={t.id} className="rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    <Badge style={{ background: SST_TOKENS.navy, color: "white" }}>{t.codigo_sap}</Badge>
                    <span className="font-medium">{t.nombre}</span>
                    <span className="text-[11px] uppercase text-muted-foreground">{t.clase}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{t.descripcion}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground"><b>En LIPgo:</b> {t.origen_lipgo}</div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
