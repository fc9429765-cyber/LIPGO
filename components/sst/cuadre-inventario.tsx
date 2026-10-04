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
  aplicarCorreccionesConteo,
  getReglasNovedad,
  guardarReglaNovedad,
  eliminarReglaNovedad,
  sembrarReglasNovedad,
  getUmbralConteo,
  guardarUmbralConteo,
  solicitarRecuentoLinea,
  reversarAjusteInventario,
  reactivarAjusteInventario,
} from "@/lib/sig-actions"
import { proponerCodigo, opcionesPara, opcionDe, codigoReversoDe, OPCIONES_CODIGO, type ReglaNovedad } from "@/lib/conteo-novedades"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { useAuth } from "@/components/auth-provider"
import { SigHeader, SigFilterBar, SigKpi } from "@/components/sst/sig-ui"
import { SignaturePad, type SignaturePadHandle } from "@/components/rrhh/signature-pad"
import type { SigInventarioCuadre, SigInventarioCuadreDetalle, SigInventarioAjuste } from "@/lib/sig-types"
import { Loader2, ClipboardCheck, Plus, Lock, Trash2, FileCheck2, ArrowLeft, Pencil, BookOpen, CheckCircle2, ArrowDownToLine, ArrowUpFromLine, PackageSearch, User, ChevronDown, ChevronRight, ListChecks, Wand2, RotateCcw, Undo2, Settings2, Repeat, ShieldCheck } from "lucide-react"

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
  // Cómo se recorre el conteo: por UBICACIÓN de menor a mayor (orden natural:
  // A2 antes que A10) es como se cuenta en piso; por producto es la vista de
  // revisión. Pedido de gerencia 2026-10-02. Se recuerda en el navegador.
  const [agrupar, setAgrupar] = useState<"ubicacion" | "producto">("ubicacion")
  useEffect(() => {
    try {
      const v = localStorage.getItem("lipgo:conteo:agrupar")
      if (v === "producto" || v === "ubicacion") setAgrupar(v)
    } catch {}
  }, [])
  const cambiarAgrupar = (v: "ubicacion" | "producto") => {
    setAgrupar(v)
    try { localStorage.setItem("lipgo:conteo:agrupar", v) } catch {}
  }
  const ordenNatural = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" })
  // Vista del conteo abierto: la hoja de conteo (no cambia) o "Diferencias",
  // donde el revisor ve la novedad de cada línea, el código propuesto y aplica.
  const [vista, setVista] = useState<"hoja" | "diferencias" | "correcciones" | "acta">("hoja")
  // Propuesta por línea (id del detalle → código y pareja), editable por el revisor.
  const [propuestas, setPropuestas] = useState<Map<number, { codigo: string; parejaId: number | null; aviso: string | null; coincidencia: string | null }>>(new Map())
  const [aplicando, setAplicando] = useState(false)
  // Diccionario de novedades (editable, SQL 214; sin filas se usan las reglas fijas) y umbral de clave.
  const [reglas, setReglas] = useState<ReglaNovedad[]>([])
  const [origenReglas, setOrigenReglas] = useState<"tabla" | "fijas">("fijas")
  const [umbral, setUmbral] = useState<number>(50)
  const [umbralEdit, setUmbralEdit] = useState<string>("50")
  const [claveConteo, setClaveConteo] = useState("")
  const [verDiccionario, setVerDiccionario] = useState(false)
  const [nuevaRegla, setNuevaRegla] = useState<{ codigo: string; patron: string; etiqueta: string }>({ codigo: "551", patron: "", etiqueta: "" })
  // Historial de correcciones: ver anuladas (para reactivar) y diálogo de reverso.
  const [verAnulados, setVerAnulados] = useState(false)
  const [reversoDlg, setReversoDlg] = useState<{ ajuste: SigInventarioAjuste; clave: string; motivo: string } | null>(null)
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
    const [c, a, p, rg, um] = await Promise.all([getCuadres(pid), getAjustesInventario(pid, verAnulados), getProductosInventario(pid), getReglasNovedad(pid), getUmbralConteo(pid)])
    if (c.success) setCuadres(c.data)
    if (a.success) setAjustes(a.data)
    if (p.success) setProductos(p.data)
    if (rg.success) { setReglas(rg.data); setOrigenReglas(rg.origen) }
    if (um.success) { setUmbral(um.umbral); setUmbralEdit(String(um.umbral)) }
    setLoading(false)
  }
  useEffect(() => {
    cargar()
    setSel(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proyecto])

  async function abrir(c: SigInventarioCuadre) {
    setSel(c)
    setVista("hoja")
    setPropuestas(new Map())
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
      // Conteo aprobado: las correcciones 701/702 ya se contabilizaron, el sistema
      // quedó igual al físico y la diferencia vigente es 0; lo encontrado se
      // reporta como hallazgo corregido.
      body: sel.estado === "aprobado"
        ? [
            ["Stock sistema (libro, antes de corregir)", fmtN(sel.total_sistema)],
            ["Conteo físico", fmtN(sel.total_conteo)],
            ["Hallazgo corregido con 701/702", fmtN(sel.total_diferencia)],
            ["Diferencia vigente (tras correcciones)", "0"],
            ["Ítems contados", fmtN(sel.items)],
            ["Ítems corregidos", fmtN(sel.items_con_diferencia)],
          ]
        : [
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
      doc.text(sel.estado === "aprobado" ? "Ítems corregidos (701 sobrante / 702 faltante):" : "Ítems con diferencia:", 14, y)
      autoTable(doc, {
        startY: y + 3,
        head: [sel.estado === "aprobado" ? ["Producto", "Lote", "Sistema antes", "Conteo", "Corrección"] : ["Producto", "Lote", "Sistema", "Conteo", "Diferencia"]],
        body: difs.slice(0, 40).map((d) => [d.producto ?? "", d.lote ?? "", fmtN(d.sistema), fmtN(d.conteo), sel.estado === "aprobado" ? `${Number(d.diferencia) > 0 ? "701 +" : "702 "}${fmtN(d.diferencia)}` : fmtN(d.diferencia)]),
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

  // Novedad de la línea (la escribe el contador, lote por lote). Se guarda con
  // la línea en el mismo onBlur que la cantidad; el revisor la lee en "Diferencias".
  function setNovedad(id: number, v: string) {
    dirtyRef.current.add(id)
    setDetalle((prev) => prev.map((d) => (d.id === id ? { ...d, observacion: v } : d)))
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
    const activos = ajustes.filter((a) => a.activo !== false)
    const total = activos.length
    const pendientes = activos.filter((a) => (a.estado ?? "registrado") !== "aprobado").length
    const aprobados = total - pendientes
    let faltante = 0, sobrante = 0
    for (const a of activos) {
      const c = Number(a.cantidad) || 0
      if (c < 0) faltante += Math.abs(c)
      else sobrante += c
    }
    return { total, pendientes, aprobados, faltante, sobrante }
  }, [ajustes])
  // Correcciones ya reversadas: id original → id del reverso (enlace por el marcador "[rev de aj#id]" en soporte).
  const reversadas = useMemo(() => {
    const m = new Map<number, number>()
    for (const a of ajustes) {
      if (a.activo === false) continue
      const mm = /\[rev de aj#(\d+)\]/.exec(String(a.soporte ?? ""))
      if (mm) m.set(Number(mm[1]), a.id)
    }
    return m
  }, [ajustes])

  const fmt = (n: any) => (Number(n) || 0).toLocaleString("es-CO")
  const difTotal = useMemo(() => detalle.reduce((s, d) => s + (Number(d.diferencia) || 0), 0), [detalle])
  const conDif = useMemo(() => detalle.filter((d) => (Number(d.diferencia) || 0) !== 0).length, [detalle])

  // Agrupa el detalle (subtotal por grupo + filas por lote):
  //  - por UBICACIÓN: grupos = ubicaciones en orden natural de menor a mayor
  //    (A2, A10, A14, B42, E37…), filas = producto/lote dentro de cada una;
  //  - por PRODUCTO: grupos = productos, filas = lotes ordenados por ubicación.
  const grupos = useMemo(() => {
    const map = new Map<
      string,
      { key: string; producto: string; codproducto: string | null; sistema: number; conteo: number; diferencia: number; filas: SigInventarioCuadreDetalle[] }
    >()
    const porUbic = agrupar === "ubicacion"
    for (const d of detalle) {
      const key = porUbic ? (d.location || "Sin ubicación") : (d.codproducto || d.producto || "—")
      let g = map.get(key)
      if (!g) {
        g = porUbic
          ? { key, producto: d.location || "Sin ubicación", codproducto: null, sistema: 0, conteo: 0, diferencia: 0, filas: [] }
          : { key, producto: d.producto || d.codproducto || "—", codproducto: d.codproducto, sistema: 0, conteo: 0, diferencia: 0, filas: [] }
        map.set(key, g)
      }
      g.sistema += Number(d.sistema) || 0
      g.conteo += Number(d.conteo) || 0
      g.diferencia += Number(d.diferencia) || 0
      g.filas.push(d)
    }
    const lista = Array.from(map.values())
    for (const g of lista) {
      g.filas.sort((a, b) =>
        porUbic
          ? (a.producto || "").localeCompare(b.producto || "") || ordenNatural(a.lote || "", b.lote || "")
          : ordenNatural(a.location || "", b.location || "") || ordenNatural(a.lote || "", b.lote || ""),
      )
    }
    return lista.sort((a, b) => (porUbic ? ordenNatural(a.producto, b.producto) : a.producto.localeCompare(b.producto)))
  }, [detalle, agrupar])

  // ---------- Diferencias del conteo: novedad → código → aplicar ----------
  // Una sola fuente: lo "aplicado" de una línea es la suma de las correcciones
  // activas de este conteo para ese producto/lote/ubicación (tabla de
  // correcciones); lo "pendiente" es su diferencia menos eso.
  const claveLinea = (x: { codproducto?: string | null; lote?: string | null; location?: string | null }) => `${x.codproducto ?? ""}|${x.lote ?? ""}|${x.location ?? ""}`
  const ajustesDelConteo = useMemo(() => (sel ? ajustes.filter((a) => a.cuadre_id === sel.id && a.activo !== false) : []), [ajustes, sel?.id])
  const aplicadoPorClave = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of ajustesDelConteo) { const k = claveLinea(a); m.set(k, (m.get(k) ?? 0) + (Number(a.cantidad) || 0)) }
    return m
  }, [ajustesDelConteo])
  const pendienteDe = (d: SigInventarioCuadreDetalle) => Math.round(((Number(d.diferencia) || 0) - (aplicadoPorClave.get(claveLinea(d)) ?? 0)) * 100) / 100
  const lineasDif = useMemo(
    () =>
      detalle
        .filter((d) => (Number(d.diferencia) || 0) !== 0 || (aplicadoPorClave.get(claveLinea(d)) ?? 0) !== 0)
        .sort((a, b) => ordenNatural(a.location || "", b.location || "") || (a.producto || "").localeCompare(b.producto || "") || ordenNatural(a.lote || "", b.lote || "")),
    [detalle, aplicadoPorClave],
  )
  const pendientesCount = lineasDif.filter((d) => pendienteDe(d) !== 0).length
  // Líneas que pueden ser pareja de `d` para 309 (otro lote) o 311 (misma lote, otra ubicación).
  const candidatasPareja = (d: SigInventarioCuadreDetalle, tipo: "lote" | "ubicacion") =>
    lineasDif.filter((o) => o.id !== d.id && o.codproducto === d.codproducto && pendienteDe(o) !== 0 && Math.sign(pendienteDe(o)) !== Math.sign(pendienteDe(d)) && (tipo === "lote" ? o.lote !== d.lote : o.lote === d.lote && o.location !== d.location))

  // Lee la novedad de cada línea pendiente y propone código (y pareja cuando aplica).
  function interpretar(conservar = true) {
    setPropuestas((prev) => {
      const next = new Map(conservar ? prev : [])
      for (const d of lineasDif) {
        const pend = pendienteDe(d)
        if (pend === 0) { next.delete(d.id); continue }
        if (conservar && next.has(d.id)) continue
        const p = proponerCodigo(d.observacion, pend, reglas)
        let parejaId: number | null = null
        if (p.pareja) {
          const cands = candidatasPareja(d, p.pareja).sort((a, b) => Math.abs(Math.abs(pendienteDe(a)) - Math.abs(pend)) - Math.abs(Math.abs(pendienteDe(b)) - Math.abs(pend)))
          parejaId = cands[0]?.id ?? null
        }
        next.set(d.id, { codigo: p.codigo, parejaId, aviso: p.aviso, coincidencia: p.coincidencia })
      }
      return next
    })
  }

  async function abrirDiferencias() {
    setVista("diferencias")
    interpretar(false)
  }

  // Aplica las correcciones de las líneas indicadas con el código confirmado.
  async function aplicarLineas(ids: number[]) {
    if (!sel || ids.length === 0) return
    const items = ids
      .map((id) => ({ id, p: propuestas.get(id) }))
      .filter((x) => x.p && opcionDe(x.p.codigo)?.aplicable)
      .map((x) => ({ detalleId: x.id, codigo: x.p!.codigo, parejaDetalleId: x.p!.parejaId }))
    if (items.length === 0) { toast({ title: "Nada para aplicar", description: "Las líneas elegidas no tienen un código aplicable desde el conteo." }); return }
    const resumen = items.length === 1 ? "1 corrección" : `${items.length} correcciones`
    // Umbral: por encima de N unidades se exige la clave personal (proceso inv_conteo_umbral).
    const sobreUmbral = items.filter((it) => { const d = detalle.find((x) => x.id === it.detalleId); return d ? Math.abs(pendienteDe(d)) > umbral : false })
    if (sobreUmbral.length > 0 && !claveConteo.trim()) {
      toast({ title: `${sobreUmbral.length} línea(s) superan el umbral de ${fmt(umbral)} unidades`, description: "Escribe tu clave personal de autorización en la casilla de arriba para aplicarlas.", variant: "destructive" as any })
      return
    }
    if (!confirm(`Se contabilizarán ${resumen} con fecha ${sel.fecha ? fechaAnteriorTexto(sel.fecha) : "de la víspera"} (mueven el stock: faltantes salen, sobrantes entran) y quedarán registradas con su código y la novedad como motivo.${sobreUmbral.length ? `\n\n${sobreUmbral.length} de ellas superan el umbral de ${fmt(umbral)} unidades y se autorizan con tu clave.` : ""}\n\n¿Aplicar?`)) return
    setAplicando(true)
    const r = await aplicarCorreccionesConteo(sel.id, items, actor, { clave: claveConteo })
    setAplicando(false)
    if (r.aplicadas > 0) toast({ title: `${r.aplicadas} corrección(es) contabilizada(s)`, description: r.pendientes === 0 ? "No quedan diferencias pendientes: ya puedes firmar el acta y cerrar el mes." : `Quedan ${r.pendientes} línea(s) pendientes.` })
    if (r.errores.length) toast({ title: `${r.errores.length} línea(s) no se aplicaron`, description: r.errores.slice(0, 3).join(" · "), variant: "destructive" as any })
    else if (r.error && r.aplicadas === 0) toast({ title: "No se pudo aplicar", description: r.error })
    await cargar()
    const det = await getCuadreDetalle(sel.id)
    if (det.success) setDetalle(det.data)
    if (r.pendientes === 0 && r.aplicadas > 0 && sel.estado === "contado") setSel({ ...sel, estado: "cerrado" })
    setPropuestas(new Map())
  }

  // Recuento: devuelve la línea al contador (queda "sin digitar" con la marca RECONTAR).
  async function recontar(d: SigInventarioCuadreDetalle) {
    if (!sel) return
    if (!confirm(`Pedir recuento de ${d.producto} lote ${d.lote || "—"} en ${d.location || "—"}.\n\nLa línea vuelve al contador como pendiente; su cantidad actual (${fmt(d.conteo)}) queda de referencia hasta que la recuente.\n\n¿Continuar?`)) return
    const r = await solicitarRecuentoLinea(d.id, actor)
    if (!r.success) { toast({ title: "No se pudo pedir el recuento", description: r.error }); return }
    toast({ title: "Recuento solicitado", description: "La línea aparece marcada en la hoja de conteo." })
    const det = await getCuadreDetalle(sel.id)
    if (det.success) setDetalle(det.data)
    setPropuestas((prev) => { const n = new Map(prev); n.delete(d.id); return n })
  }

  // Reverso de una corrección contabilizada (código de reverso + clave personal).
  async function confirmarReverso() {
    if (!reversoDlg) return
    const { ajuste, clave, motivo } = reversoDlg
    if (!clave.trim()) { toast({ title: "Escribe tu clave personal" }); return }
    if (!motivo.trim()) { toast({ title: "Indica el motivo del reverso" }); return }
    setSaving(true)
    const r = await reversarAjusteInventario(ajuste.id, clave, motivo, actor)
    setSaving(false)
    if (!r.success) { toast({ title: "No se pudo reversar", description: r.error, variant: "destructive" as any }); return }
    toast({ title: "Corrección reversada", description: `Se contabilizó el reverso (corrección #${r.reversoId}${r.invtransId ? ", mov #" + r.invtransId : ""}) con fecha de hoy.` })
    setReversoDlg(null)
    await cargar()
    if (sel) { const det = await getCuadreDetalle(sel.id); if (det.success) setDetalle(det.data) }
  }

  async function reactivar(a: SigInventarioAjuste) {
    if (!confirm(`Reactivar la corrección #${a.id} (${a.producto}, ${a.cod_movimiento ?? "—"} ${fmt(a.cantidad)}). Vuelve a "registrado"; no mueve stock hasta aprobarla.\n\n¿Continuar?`)) return
    const r = await reactivarAjusteInventario(a.id)
    if (r.success) { toast({ title: "Corrección reactivada" }); cargar() }
    else toast({ title: "No se pudo reactivar", description: r.error })
  }

  // Diccionario de novedades y umbral (editable).
  async function guardarRegla() {
    if (!nuevaRegla.patron.trim()) { toast({ title: "Escribe el texto o patrón" }); return }
    const r = await guardarReglaNovedad(null, { codigo: nuevaRegla.codigo, patron: nuevaRegla.patron.trim(), etiqueta: nuevaRegla.etiqueta.trim() || null, orden: 50 }, actor)
    if (!r.success) { toast({ title: "No se pudo guardar la regla", description: r.error }); return }
    setNuevaRegla({ codigo: nuevaRegla.codigo, patron: "", etiqueta: "" })
    const rg = await getReglasNovedad(Number(proyecto))
    if (rg.success) { setReglas(rg.data); setOrigenReglas(rg.origen) }
  }
  async function borrarRegla(id: number) {
    const r = await eliminarReglaNovedad(id)
    if (!r.success) { toast({ title: "No se pudo eliminar", description: r.error }); return }
    const rg = await getReglasNovedad(Number(proyecto))
    if (rg.success) { setReglas(rg.data); setOrigenReglas(rg.origen) }
  }
  async function sembrarReglas() {
    const r = await sembrarReglasNovedad(actor)
    if (!r.success) { toast({ title: "No se pudo copiar el diccionario", description: r.error }); return }
    toast({ title: r.creadas ? `${r.creadas} reglas copiadas; ya puedes editarlas` : "El diccionario ya estaba en la tabla" })
    const rg = await getReglasNovedad(Number(proyecto))
    if (rg.success) { setReglas(rg.data); setOrigenReglas(rg.origen) }
  }
  async function guardarUmbral() {
    const r = await guardarUmbralConteo(Number(proyecto), Number(umbralEdit), actor)
    if (!r.success) { toast({ title: "No se pudo guardar el umbral", description: r.error }); return }
    const um = await getUmbralConteo(Number(proyecto))
    if (um.success) { setUmbral(um.umbral); setUmbralEdit(String(um.umbral)) }
    toast({ title: `Umbral guardado: ${umbralEdit} unidades` })
  }

  // Recargar el historial cuando se activa/desactiva "ver anuladas".
  useEffect(() => {
    if (proyecto) cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verAnulados])

  // ---------- Vista DETALLE de un cuadre ----------
  if (sel) {
    const est = ESTADO_CUADRE[sel.estado ?? "borrador"] ?? ESTADO_CUADRE.borrador
    const editable = sel.estado === "borrador" || sel.estado === "contado"
    // Conteo APROBADO = sus correcciones 701/702 ya se contabilizaron, así que el
    // sistema quedó igual al físico: la diferencia que se muestra es 0 y lo que
    // se encontró queda como "hallazgo corregido" (regla de gerencia 2026-10-02:
    // "una vez se aplican los códigos de corrección esto debe quedar en 0").
    // Los campos guardados (sistema, diferencia) no se tocan: son el hallazgo
    // original y de ahí sale el ERI.
    const corregido = sel.estado === "aprobado"

    // ---------- Vista DIFERENCIAS: novedad → código → aplicar ----------
    const aplicadasDe = (d: SigInventarioCuadreDetalle) => ajustesDelConteo.filter((a) => claveLinea(a) === claveLinea(d))
    const idsAplicables = lineasDif.filter((d) => pendienteDe(d) !== 0).map((d) => d.id).filter((id) => { const p = propuestas.get(id); const o = p ? opcionDe(p.codigo) : undefined; return !!o?.aplicable && (!o.pareja || !!p?.parejaId) })
    // Correcciones de ESTE conteo (incluye anuladas si se pidió verlas): trazabilidad y reverso.
    const correccionesConteo = ajustes
      .filter((a) => a.cuadre_id === sel.id)
      .sort((a, b) => (a.producto || "").localeCompare(b.producto || "") || ordenNatural(a.lote || "", b.lote || "") || a.id - b.id)
    const vistaDiferencias = (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {corregido
                ? "Conteo aprobado: cada línea con diferencia muestra la corrección que se aplicó (código, cantidad y movimiento)."
                : "Revisa cada diferencia con la novedad del contador, confirma el código y aplícala."}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setVerDiccionario(true)} title="Diccionario de novedades y umbral de clave">
                <Settings2 className="mr-1 h-4 w-4" /> Diccionario
              </Button>
              <Button size="sm" variant="outline" onClick={() => interpretar(false)} disabled={aplicando} title="Vuelve a leer la novedad de cada línea y propone el código">
                <Wand2 className="mr-1 h-4 w-4" /> Interpretar novedades
              </Button>
              <Button size="sm" onClick={() => aplicarLineas(idsAplicables)} disabled={aplicando || idsAplicables.length === 0} style={{ background: SST_TOKENS.ok, color: "white" }} title="Aplica todas las líneas pendientes con el código confirmado">
                {aplicando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Aplicar todas ({idsAplicables.length})
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SigKpi label="Líneas con diferencia" value={lineasDif.length} accent={SST_TOKENS.navy} />
            <SigKpi label="Pendientes de aplicar" value={pendientesCount} accent={pendientesCount ? SST_TOKENS.bad : SST_TOKENS.ok} valueColor={pendientesCount ? SST_TOKENS.bad : SST_TOKENS.ok} />
            <SigKpi label="Aplicadas" value={lineasDif.length - pendientesCount} accent={SST_TOKENS.ok} valueColor={SST_TOKENS.ok} />
            <SigKpi label="Fecha de las correcciones" value={sel.fecha ? fechaAnteriorTexto(sel.fecha) : "víspera"} accent={SST_TOKENS.navy} />
          </div>

          {lineasDif.some((d) => Math.abs(pendienteDe(d)) > umbral) && (
            <Card className="flex flex-wrap items-center gap-3 p-3" style={{ borderColor: SST_TOKENS.warn }}>
              <ShieldCheck className="h-4 w-4" style={{ color: SST_TOKENS.warn }} />
              <div className="text-xs">
                <b>Umbral de aprobación: {fmt(umbral)} unidades.</b> Las líneas marcadas lo superan y se aplican solo con tu clave personal de autorización (queda en el registro de autorizaciones).
              </div>
              <Input type="password" value={claveConteo} onChange={(e) => setClaveConteo(e.target.value)} placeholder="Tu clave personal" autoComplete="off" className="h-8 w-44" />
              <AyudaClaveAutorizacion />
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            El contador escribió la novedad en cada línea; el sistema propone el código y tú lo confirmas o lo cambias antes de aplicar. Sin novedad se propone 701 (sobrante) o 702 (faltante).
            Un cruce de lote (309) o un mal ubicado (311) se aplica en pareja: sale del lote o ubicación que falta y entra al que sobra. Las cuarentenas (344) se hacen en Transacciones de Inventario.
          </p>

          <Card className="overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                    <th className="px-3 py-2">Ubic.</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Lote</th>
                    <th className="px-3 py-2 text-right">Sistema</th>
                    <th className="px-3 py-2 text-right">Físico</th>
                    <th className="px-3 py-2 text-right">Pendiente</th>
                    <th className="px-3 py-2">Novedad del contador</th>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Pareja</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {lineasDif.map((d) => {
                    const pend = pendienteDe(d)
                    const p = propuestas.get(d.id)
                    const opc = p ? opcionDe(p.codigo) : undefined
                    const aplicadas = aplicadasDe(d)
                    return (
                      <tr key={d.id} className={`border-b last:border-0 align-top ${pend !== 0 ? "" : "bg-green-50/60"}`}>
                        <td className="px-3 py-1.5 text-muted-foreground">{d.location || "—"}</td>
                        <td className="px-3 py-1.5">
                          {d.producto || d.codproducto}
                          {d.codproducto && <span className="ml-1 text-[11px] text-muted-foreground">· {d.codproducto}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{d.lote || "—"}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(d.sistema)}</td>
                        <td className="px-3 py-1.5 text-right">{fmt(d.conteo)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold" style={{ color: pend === 0 ? SST_TOKENS.ok : pend > 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                          {pend > 0 ? "+" : ""}{fmt(pend)}
                        </td>
                        <td className="px-3 py-1.5 text-[12px]">
                          {d.observacion ? d.observacion : <span className="text-muted-foreground">sin novedad</span>}
                          {p?.coincidencia && <div className="text-[11px] text-muted-foreground">coincide: “{p.coincidencia}”</div>}
                          {p?.aviso && <div className="text-[11px]" style={{ color: SST_TOKENS.warn }}>{p.aviso}</div>}
                        </td>
                        <td className="px-3 py-1.5">
                          {pend !== 0 ? (
                            <select
                              className="h-8 rounded-md border bg-background px-2 text-xs"
                              value={p?.codigo ?? ""}
                              disabled={aplicando}
                              onChange={(e) => {
                                const codigo = e.target.value
                                const o = opcionDe(codigo)
                                const parejaId = o?.pareja ? (candidatasPareja(d, o.pareja)[0]?.id ?? null) : null
                                setPropuestas((prev) => new Map(prev).set(d.id, { codigo, parejaId, aviso: null, coincidencia: p?.coincidencia ?? null }))
                              }}
                            >
                              {opcionesPara(pend).map((o) => (
                                <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {pend !== 0 && opc?.pareja ? (
                            (() => {
                              const cands = candidatasPareja(d, opc.pareja)
                              return cands.length === 0 ? (
                                <span className="text-[11px]" style={{ color: SST_TOKENS.bad }}>sin pareja posible</span>
                              ) : (
                                <select
                                  className="h-8 rounded-md border bg-background px-2 text-xs"
                                  value={p?.parejaId ?? ""}
                                  disabled={aplicando}
                                  onChange={(e) => setPropuestas((prev) => new Map(prev).set(d.id, { ...(p as any), parejaId: e.target.value ? Number(e.target.value) : null }))}
                                >
                                  <option value="">elige la pareja</option>
                                  {cands.map((c) => (
                                    <option key={c.id} value={c.id}>{opc.pareja === "lote" ? `lote ${c.lote}` : c.location} · {pendienteDe(c) > 0 ? "+" : ""}{fmt(pendienteDe(c))}</option>
                                  ))}
                                </select>
                              )
                            })()
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {pend !== 0 ? (
                            <div className="flex flex-col items-start gap-1">
                              {Math.abs(pend) > umbral && (
                                <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: SST_TOKENS.warn }} title={`Supera el umbral de ${fmt(umbral)} unidades: requiere clave`}>
                                  <ShieldCheck className="h-3 w-3" /> requiere clave
                                </span>
                              )}
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  disabled={aplicando || !opc?.aplicable || (!!opc?.pareja && !p?.parejaId)}
                                  onClick={() => aplicarLineas([d.id])}
                                  style={{ background: SST_TOKENS.navy, color: "white" }}
                                >
                                  Aplicar
                                </Button>
                                {aplicadas.length === 0 && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={aplicando} onClick={() => recontar(d)} title="Devolver la línea al contador para recontarla antes de corregir">
                                    <RotateCcw className="mr-1 h-3 w-3" /> Recontar
                                  </Button>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px]" style={{ color: SST_TOKENS.ok }}>
                              Aplicada
                              {aplicadas.map((a) => (
                                <div key={a.id} className="text-muted-foreground" title={a.soporte ?? ""}>
                                  {a.cod_movimiento} {Number(a.cantidad) > 0 ? "+" : ""}{fmt(a.cantidad)}{a.invtrans_id ? ` · mov #${a.invtrans_id}` : ""}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {lineasDif.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-sm text-muted-foreground">Este conteo no tiene diferencias.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
    )

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
            {(sel.estado === "contado" || sel.estado === "cerrado") && pendientesCount > 0 && (
              <Button size="sm" onClick={abrirDiferencias} style={{ background: SST_TOKENS.navy, color: "white" }} title="Revisar cada diferencia con su novedad, confirmar el código y aplicarla">
                <ListChecks className="mr-1 h-4 w-4" /> Revisar diferencias ({pendientesCount})
              </Button>
            )}
            {sel.estado === "cerrado" && (
              <Button size="sm" disabled={saving} onClick={cerrarMes} style={{ background: SST_TOKENS.ok, color: "white" }} title={sel.tipo === "total" ? "Aprueba las correcciones de este conteo y las registra como transacciones. Este conteo queda como inventario inicial del mes." : "Aprueba las correcciones de este conteo cíclico y las registra como transacciones del mes. No modifica el inventario inicial (Conteo total)."}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />} {sel.tipo === "total" ? "Cerrar mes (ajusta stock)" : "Cerrar conteo cíclico (ajusta stock)"}
              </Button>
            )}
            {sel.estado === "aprobado" && (
              <Badge style={{ background: SST_TOKENS.ok, color: "white" }} className="self-center">
                {sel.tipo === "total" ? "Mes cerrado · inventario inicial del mes" : "Conteo cíclico cerrado · stock ajustado"}
              </Badge>
            )}
          </div>
        </div>

        {/* Tarjetas: las dos de la derecha abren su pestaña (Diferencias / Correcciones). */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SigKpi label={corregido ? "Sistema (ajustado)" : "Sistema"} value={fmt(corregido ? detalle.reduce((s, d) => s + (Number(d.conteo) || 0), 0) : sel.total_sistema)} accent={SST_TOKENS.navy} />
          <SigKpi label="Conteo físico" value={fmt(detalle.reduce((s, d) => s + (Number(d.conteo) || 0), 0))} accent={SST_TOKENS.navy} />
          <div role="button" tabIndex={0} className="cursor-pointer rounded-lg transition hover:ring-2 hover:ring-offset-1" title="Abrir Diferencias" onClick={abrirDiferencias} onKeyDown={(e) => e.key === "Enter" && abrirDiferencias()}>
            {corregido ? (
              <SigKpi label="Diferencia · ver" value="0" accent={SST_TOKENS.ok} valueColor={SST_TOKENS.ok} />
            ) : (
              <SigKpi label={`Diferencia · ver${pendientesCount ? ` (${pendientesCount} pendientes)` : ""}`} value={fmt(difTotal)} accent={difTotal === 0 ? SST_TOKENS.ok : SST_TOKENS.bad} valueColor={difTotal === 0 ? SST_TOKENS.ok : SST_TOKENS.bad} />
            )}
          </div>
          <div role="button" tabIndex={0} className="cursor-pointer rounded-lg transition hover:ring-2 hover:ring-offset-1" title="Abrir Correcciones de este conteo" onClick={() => setVista("correcciones")} onKeyDown={(e) => e.key === "Enter" && setVista("correcciones")}>
            {corregido ? (
              <SigKpi label="Hallazgo corregido · ver" value={`${difTotal > 0 ? "+" : ""}${fmt(difTotal)} · ${conDif} ítems`} accent={SST_TOKENS.navy} />
            ) : (
              <SigKpi label="Ítems con diferencia · ver" value={conDif} accent={conDif ? SST_TOKENS.bad : SST_TOKENS.ok} valueColor={conDif ? SST_TOKENS.bad : SST_TOKENS.ok} />
            )}
          </div>
        </div>

        <Tabs value={vista} onValueChange={(v) => { setVista(v as any); if (v === "diferencias") interpretar(true) }}>
          <TabsList>
            <TabsTrigger value="hoja">Hoja de conteo</TabsTrigger>
            <TabsTrigger value="diferencias">Diferencias{lineasDif.length ? ` (${pendientesCount ? pendientesCount + " pendientes" : lineasDif.length})` : ""}</TabsTrigger>
            <TabsTrigger value="correcciones">Correcciones ({correccionesConteo.filter((a) => a.activo !== false).length})</TabsTrigger>
            <TabsTrigger value="acta">Acta{sel.firmado ? " · firmada" : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="hoja" className="space-y-3 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex overflow-hidden rounded-md border text-[11px]" title="Orden del conteo: por ubicación de menor a mayor (como se recorre el piso) o por producto">
                <button type="button" onClick={() => cambiarAgrupar("ubicacion")} className={`px-2 py-1 ${agrupar === "ubicacion" ? "bg-muted font-semibold" : "text-muted-foreground"}`}>Por ubicación</button>
                <button type="button" onClick={() => cambiarAgrupar("producto")} className={`px-2 py-1 ${agrupar === "producto" ? "bg-muted font-semibold" : "text-muted-foreground"}`}>Por producto</button>
              </div>
              {editable ? (
                <span className="text-[11px] text-muted-foreground">
                  Cada línea se guarda sola al contarla — varias personas pueden contar a la vez sin pisarse. En "Novedad" el contador escribe qué pasó (avería, cruce de lote, mal ubicado…).
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">Hoja de conteo tal como se digitó. Las diferencias y sus correcciones están en las otras pestañas.</span>
              )}
            </div>
        <Card className="overflow-hidden">
          {loadingDet ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="max-h-[55vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                    <th className="px-3 py-2">{agrupar === "ubicacion" ? "Ubicación · producto" : "Producto"}</th>
                    <th className="px-3 py-2">Lote</th>
                    <th className="px-3 py-2">Ubic.</th>
                    <th className="px-3 py-2 text-right">{corregido ? "Sistema (ajustado)" : "Sistema"}</th>
                    <th className="px-3 py-2 text-right">Conteo</th>
                    <th className="px-3 py-2 text-right">Diferencia</th>
                    {corregido && <th className="px-3 py-2 text-right" title="Lo que se encontró al contar; ya corregido con 701 (sobrante) o 702 (faltante) con fecha de la víspera">Hallazgo corregido</th>}
                    <th className="px-3 py-2">Contado por</th>
                    <th className="px-3 py-2" title="La escribe el contador lote por lote: avería, cruce de lote, mal ubicado, devolución… El revisor la usa en Diferencias para elegir el código">Novedad</th>
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
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(corregido ? g.conteo : g.sistema)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(g.conteo)}</td>
                          {corregido ? (
                            <>
                              <td className="px-3 py-1.5 text-right font-semibold" style={{ color: SST_TOKENS.ok }}>0</td>
                              <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">{gDif === 0 ? "—" : `${gDif > 0 ? "+" : ""}${fmt(gDif)}`}</td>
                            </>
                          ) : (
                            <td className="px-3 py-1.5 text-right font-semibold" style={{ color: gDif === 0 ? undefined : gDif > 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                              {gDif > 0 ? "+" : ""}{fmt(gDif)}
                            </td>
                          )}
                          <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">{contadas}/{g.filas.length} líneas</td>
                          <td className="px-3 py-1.5"></td>
                        </tr>
                        {!colapsado && g.filas.map((d) => {
                          const dif = Number(d.diferencia) || 0
                          return (
                            <tr key={d.id} className={`border-b last:border-0 ${!d.contado_en && String(d.contado_por || "").startsWith("RECONTAR") ? "bg-amber-50" : dif !== 0 && !corregido ? "bg-red-50" : ""}`}>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {agrupar === "ubicacion" ? (
                                  <>
                                    <span className="text-foreground">{d.producto || d.codproducto || "—"}</span>
                                    {d.codproducto && <span className="ml-1 text-[11px]">· {d.codproducto}</span>}
                                  </>
                                ) : null}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">{d.lote || "—"}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{d.location || "—"}</td>
                              <td className="px-3 py-1.5 text-right">{fmt(corregido ? d.conteo : d.sistema)}</td>
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
                              {corregido ? (
                                <>
                                  <td className="px-3 py-1.5 text-right font-medium" style={{ color: SST_TOKENS.ok }}>0</td>
                                  <td className="px-3 py-1.5 text-right text-[11px] text-muted-foreground">
                                    {dif === 0 ? "—" : `${dif > 0 ? "+" : ""}${fmt(dif)} · ${dif > 0 ? "701" : "702"}`}
                                  </td>
                                </>
                              ) : (
                                <td className="px-3 py-1.5 text-right font-medium" style={{ color: dif === 0 ? undefined : dif > 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                                  {dif > 0 ? "+" : ""}{fmt(dif)}
                                </td>
                              )}
                              <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                                {!d.contado_en && String(d.contado_por || "").startsWith("RECONTAR") ? (
                                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: SST_TOKENS.warn }} title={d.contado_por ?? ""}>
                                    <RotateCcw className="h-3 w-3" /> Recontar
                                  </span>
                                ) : d.contado_por ? (
                                  <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{d.contado_por}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-[12px]">
                                {editable ? (
                                  <Input
                                    type="text"
                                    value={d.observacion ?? ""}
                                    placeholder="novedad (avería, cruce de lote, mal ubicado…)"
                                    onChange={(e) => setNovedad(d.id, e.target.value)}
                                    onBlur={() => guardarLinea(d.id)}
                                    className="h-7 w-56 text-[12px]"
                                  />
                                ) : (
                                  <span className="text-muted-foreground">{d.observacion || "—"}</span>
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
          </TabsContent>

          <TabsContent value="diferencias" className="pt-3">{vistaDiferencias}</TabsContent>

          {/* CORRECCIONES DE ESTE CONTEO: trazabilidad (código, cantidad, novedad, movimiento) y reverso */}
          <TabsContent value="correcciones" className="space-y-3 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Correcciones generadas por este conteo, fechadas {sel.fecha ? fechaAnteriorTexto(sel.fecha) : "la víspera"}: código, cantidad, la novedad como motivo y el movimiento real que generó.
                Una contabilizada se reversa con tu clave (queda enlazada a su reverso); una anulada antes de contabilizar se puede reactivar.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setVerDiccionario(true)} title="Diccionario de novedades y umbral de clave">
                  <Settings2 className="mr-1 h-4 w-4" /> Diccionario y umbral
                </Button>
                <Button size="sm" variant={verAnulados ? "secondary" : "ghost"} onClick={() => setVerAnulados((v) => !v)} title="Mostrar las correcciones anuladas para poder reactivarlas">
                  <Undo2 className="mr-1 h-4 w-4" /> {verAnulados ? "Ocultar anuladas" : "Ver anuladas"}
                </Button>
              </div>
            </div>
            {correccionesConteo.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                Este conteo no tiene correcciones{sel.estado === "contado" || sel.estado === "cerrado" ? ": se aplican desde la pestaña Diferencias" : ""}.
              </Card>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Lote</th>
                      <th className="px-3 py-2">Ubic.</th>
                      <th className="px-3 py-2 text-center">Cód.</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2">Motivo (novedad)</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2">Mov.</th>
                      <th className="px-3 py-2">Aprobó</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {correccionesConteo.map((a) => {
                      const aprobado = (a.estado ?? "registrado") === "aprobado"
                      const rev = codigoReversoDe(a.cod_movimiento, a.direccion)
                      return (
                        <tr key={a.id} className={`group border-b last:border-0 ${a.activo === false ? "opacity-60" : ""}`}>
                          <td className="px-3 py-1.5 whitespace-nowrap">{a.fecha}</td>
                          <td className="px-3 py-1.5">
                            <div className="font-medium">{a.producto}</div>
                            {a.codproducto && <div className="text-[11px] text-muted-foreground">{a.codproducto} · #{a.id}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.lote}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.location}</td>
                          <td className="px-3 py-1.5 text-center"><Badge style={{ background: SST_TOKENS.navy, color: "white" }} title={a.tipo ?? ""}>{a.cod_movimiento || "—"}</Badge></td>
                          <td className="px-3 py-1.5 text-right font-medium" style={{ color: (a.cantidad ?? 0) < 0 ? SST_TOKENS.bad : SST_TOKENS.ok }}>{(a.cantidad ?? 0) > 0 ? "+" : ""}{fmt(a.cantidad)}</td>
                          <td className="px-3 py-1.5 text-[12px]" title={a.soporte ?? ""}>{a.motivo || "—"}</td>
                          <td className="px-3 py-1.5">
                            {a.activo === false ? (
                              <Badge variant="outline">Anulada</Badge>
                            ) : aprobado ? (
                              <Badge style={{ background: SST_TOKENS.ok, color: "white" }}>Contabilizada</Badge>
                            ) : (
                              <Badge style={{ background: SST_TOKENS.warn, color: "white" }}>Registrada</Badge>
                            )}
                            {a.tipo === "reverso" && <div className="mt-0.5 text-[11px] text-muted-foreground">reverso</div>}
                            {reversadas.has(a.id) && <div className="mt-0.5 text-[11px]" style={{ color: SST_TOKENS.warn }}>reversada · #{reversadas.get(a.id)}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{a.invtrans_id ? `#${a.invtrans_id}` : "—"}</td>
                          <td className="px-3 py-1.5 text-xs">{a.aprobado_por || a.responsable || "—"}{a.aprobado_fecha ? <div className="text-[11px] text-muted-foreground">{String(a.aprobado_fecha).slice(0, 10)}</div> : null}</td>
                          <td className="px-3 py-1.5">
                            <span className="flex gap-1.5">
                              {a.activo === false ? (
                                !a.invtrans_id && (
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reactivar(a)}>
                                    <Undo2 className="mr-1 h-3 w-3" /> Reactivar
                                  </Button>
                                )
                              ) : aprobado && !!a.invtrans_id && a.tipo !== "reverso" && !reversadas.has(a.id) && !!rev ? (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReversoDlg({ ajuste: a, clave: "", motivo: "" })} title={`Reversar con ${rev.etiqueta} (requiere clave)`}>
                                  <Repeat className="mr-1 h-3 w-3" /> Reversar
                                </Button>
                              ) : !aprobado ? (
                                <>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => aprobar(a)}><CheckCircle2 className="mr-1 h-3 w-3" /> Aprobar</Button>
                                  <button onClick={() => borrarAjuste(a)} title="Eliminar (se puede reactivar)" className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                                </>
                              ) : null}
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

          <TabsContent value="acta" className="pt-3">
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
          </TabsContent>
        </Tabs>
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
                        {c.estado === "aprobado" ? (
                          <>
                            <span className="text-xs text-muted-foreground">{c.items} ítems · {c.items_con_diferencia} corregidos</span>
                            <span className="text-xs" style={{ color: SST_TOKENS.ok }} title={`Hallazgo corregido con 701/702: ${fmt(c.total_diferencia)}`}>
                              dif: 0
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-muted-foreground">{c.items} ítems · {c.items_con_diferencia} con diferencia</span>
                            <span className="text-xs" style={{ color: (c.total_diferencia ?? 0) === 0 ? SST_TOKENS.ok : SST_TOKENS.bad }}>
                              dif: {fmt(c.total_diferencia)}
                            </span>
                          </>
                        )}
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
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={abrirNomenclatura}>
                  <BookOpen className="mr-1 h-4 w-4" /> Tipos de movimiento (qué código usar)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setVerDiccionario(true)} title="Diccionario de novedades y umbral de clave">
                  <Settings2 className="mr-1 h-4 w-4" /> Diccionario y umbral
                </Button>
                <Button size="sm" variant={verAnulados ? "secondary" : "ghost"} onClick={() => setVerAnulados((v) => !v)} title="Mostrar las correcciones anuladas para poder reactivarlas">
                  <Undo2 className="mr-1 h-4 w-4" /> {verAnulados ? "Ocultar anuladas" : "Ver anuladas"}
                </Button>
              </div>
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
                            {a.activo === false ? (
                              <Badge variant="outline" title="Eliminada antes de contabilizar; se puede reactivar">Anulada</Badge>
                            ) : aprobado ? (
                              <Badge style={{ background: SST_TOKENS.ok, color: "white" }} title={`${a.aprobado_por ?? ""} ${a.aprobado_fecha ? "· " + String(a.aprobado_fecha).slice(0, 10) : ""}`}>Aprobado</Badge>
                            ) : (
                              <Badge style={{ background: SST_TOKENS.warn, color: "white" }}>Registrado</Badge>
                            )}
                            {a.tipo === "reverso" && <div className="mt-0.5 text-[11px] text-muted-foreground" title={a.motivo ?? ""}>reverso</div>}
                            {reversadas.has(a.id) && <div className="mt-0.5 text-[11px]" style={{ color: SST_TOKENS.warn }} title={`Reversada por la corrección #${reversadas.get(a.id)}`}>reversada · #{reversadas.get(a.id)}</div>}
                          </td>
                          <td className="px-3 py-1.5 text-xs">{a.responsable || "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className="flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                              {a.activo === false ? (
                                !a.invtrans_id && <button onClick={() => reactivar(a)} title="Reactivar (vuelve a registrado)" className="text-muted-foreground hover:text-green-600"><Undo2 className="h-3.5 w-3.5" /></button>
                              ) : (
                                <>
                                  {!aprobado && <button onClick={() => aprobar(a)} title="Aprobar" className="text-muted-foreground hover:text-green-600"><CheckCircle2 className="h-3.5 w-3.5" /></button>}
                                  {!aprobado && <button onClick={() => setFormAjuste({ ...a })} title="Editar" className="text-muted-foreground hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>}
                                  {aprobado && !!a.invtrans_id && a.tipo !== "reverso" && !reversadas.has(a.id) && !!codigoReversoDe(a.cod_movimiento, a.direccion) && (
                                    <button onClick={() => setReversoDlg({ ajuste: a, clave: "", motivo: "" })} title={`Reversar con ${codigoReversoDe(a.cod_movimiento, a.direccion)?.etiqueta} (requiere clave)`} className="text-muted-foreground hover:text-amber-600"><Repeat className="h-3.5 w-3.5" /></button>
                                  )}
                                  {!aprobado && <button onClick={() => borrarAjuste(a)} title="Eliminar (se puede reactivar)" className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                                </>
                              )}
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

      {/* Dialog: reverso de una corrección contabilizada (código de reverso + clave personal) */}
      <Dialog open={!!reversoDlg} onOpenChange={(o) => !o && setReversoDlg(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reversar corrección #{reversoDlg?.ajuste.id}</DialogTitle>
          </DialogHeader>
          {reversoDlg && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border p-2 text-xs">
                <div><b>{reversoDlg.ajuste.producto}</b> · lote {reversoDlg.ajuste.lote || "—"} · {reversoDlg.ajuste.location || "—"}</div>
                <div>Original: <b>{reversoDlg.ajuste.cod_movimiento}</b> {Number(reversoDlg.ajuste.cantidad) > 0 ? "+" : ""}{fmt(reversoDlg.ajuste.cantidad)} · {reversoDlg.ajuste.fecha}{reversoDlg.ajuste.invtrans_id ? ` · mov #${reversoDlg.ajuste.invtrans_id}` : ""}</div>
                <div>Reverso: <b>{codigoReversoDe(reversoDlg.ajuste.cod_movimiento, reversoDlg.ajuste.direccion)?.etiqueta}</b> {Number(reversoDlg.ajuste.cantidad) > 0 ? "−" : "+"}{fmt(Math.abs(Number(reversoDlg.ajuste.cantidad) || 0))} · con fecha de hoy</div>
                {reversoDlg.ajuste.motivo && <div className="text-muted-foreground">Motivo original: {reversoDlg.ajuste.motivo}</div>}
              </div>
              <p className="text-xs text-muted-foreground">
                La corrección original no se borra: queda enlazada a su reverso para la trazabilidad. Si la línea del conteo sigue abierta, vuelve a aparecer en Diferencias para aplicarla con el código correcto.
              </p>
              <Input value={reversoDlg.motivo} onChange={(e) => setReversoDlg({ ...reversoDlg, motivo: e.target.value })} placeholder="Motivo del reverso" />
              <div className="flex items-center gap-2">
                <Input type="password" value={reversoDlg.clave} onChange={(e) => setReversoDlg({ ...reversoDlg, clave: e.target.value })} placeholder="Tu clave personal de autorización" autoComplete="off" />
                <AyudaClaveAutorizacion />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setReversoDlg(null)}>Cancelar</Button>
                <Button size="sm" disabled={saving || !reversoDlg.clave.trim() || !reversoDlg.motivo.trim()} onClick={confirmarReverso} style={{ background: SST_TOKENS.warn, color: "white" }}>
                  {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Repeat className="mr-1 h-4 w-4" />} Reversar y contabilizar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog: diccionario de novedades y umbral de clave */}
      <Dialog open={verDiccionario} onOpenChange={setVerDiccionario}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Diccionario de novedades y umbral de clave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <Card className="space-y-2 p-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Umbral de aprobación (este proyecto)</div>
              <p className="text-xs text-muted-foreground">Una corrección del conteo cuya cantidad supere este número de unidades exige la clave personal (proceso "Aplicar corrección de conteo sobre el umbral").</p>
              <div className="flex items-center gap-2">
                <Input type="number" min={0} value={umbralEdit} onChange={(e) => setUmbralEdit(e.target.value)} className="h-8 w-32" />
                <span className="text-xs text-muted-foreground">unidades · vigente: {fmt(umbral)}</span>
                <Button size="sm" variant="outline" onClick={guardarUmbral} disabled={umbralEdit === String(umbral)}>Guardar</Button>
              </div>
            </Card>
            <Card className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Reglas novedad → código ({reglas.length}) · {origenReglas === "tabla" ? "editables" : "fijas (sin copiar aún)"}</div>
                {origenReglas === "fijas" && (
                  <Button size="sm" variant="outline" onClick={sembrarReglas} title="Copia las reglas fijas a la tabla para poder editarlas (requiere SQL 214)">Copiar para editar</Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Se evalúan en orden; gana la primera que coincide con la novedad (sin tildes ni mayúsculas). Texto simple o expresión regular entre barras, p. ej. <code>/lote (equivocad|cruzad)/</code>.</p>
              <div className="max-h-[38vh] overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left uppercase text-muted-foreground">
                      <th className="px-2 py-1">Orden</th>
                      <th className="px-2 py-1">Código</th>
                      <th className="px-2 py-1">Patrón</th>
                      <th className="px-2 py-1">Etiqueta</th>
                      <th className="px-2 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {reglas.map((r, i) => (
                      <tr key={r.id ?? `f${i}`} className="border-b last:border-0">
                        <td className="px-2 py-1 text-muted-foreground">{r.orden ?? 100}</td>
                        <td className="px-2 py-1"><Badge style={{ background: SST_TOKENS.navy, color: "white" }}>{r.codigo}</Badge></td>
                        <td className="px-2 py-1 font-mono">{r.patron}</td>
                        <td className="px-2 py-1">{r.etiqueta || "—"}</td>
                        <td className="px-2 py-1 text-right">
                          {origenReglas === "tabla" && r.id ? (
                            <button onClick={() => borrarRegla(r.id!)} title="Eliminar regla" className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <div className="text-[11px] text-muted-foreground">Código</div>
                  <select className="h-8 rounded-md border bg-background px-2 text-xs" value={nuevaRegla.codigo} onChange={(e) => setNuevaRegla({ ...nuevaRegla, codigo: e.target.value })}>
                    {OPCIONES_CODIGO.map((o) => (
                      <option key={o.codigo} value={o.codigo}>{o.etiqueta}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <div className="text-[11px] text-muted-foreground">Texto o patrón</div>
                  <Input value={nuevaRegla.patron} onChange={(e) => setNuevaRegla({ ...nuevaRegla, patron: e.target.value })} placeholder="p. ej. empaque roto" className="h-8" />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">Etiqueta</div>
                  <Input value={nuevaRegla.etiqueta} onChange={(e) => setNuevaRegla({ ...nuevaRegla, etiqueta: e.target.value })} placeholder="opcional" className="h-8 w-40" />
                </div>
                <Button size="sm" onClick={guardarRegla} disabled={origenReglas !== "tabla" || !nuevaRegla.patron.trim()} title={origenReglas !== "tabla" ? "Primero copia las reglas fijas para editar" : "Agregar regla"}>
                  <Plus className="mr-1 h-4 w-4" /> Agregar
                </Button>
              </div>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

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
