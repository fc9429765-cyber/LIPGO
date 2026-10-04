"use client"

// Panel LIP · Inventario — Exactitud y merma (ISO 9001 8.5.1). Cuadre de
// entradas/salidas + eventos de pérdida (lo que se cobra a LIP), por año y mes
// a mes, por cliente/sitio. Fuente real: invtrans + reprocesos.

import { useEffect, useRef, useState } from "react"
import { SignaturePad, type SignaturePadHandle } from "@/components/rrhh/signature-pad"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { Orden360Dialog } from "@/components/orders/orden-360"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { SigHeader, SigFilterBar, SigField, SigKpi, sigControl } from "@/components/sst/sig-ui"
import { useAuth } from "@/components/auth-provider"
import { getPanelInventarioLIP, getKardexInventario, getMovimientosProducto, getTiposMovimiento, getCuadreDiario, getPreservacionInventario, getConciliacionMensualInventario, guardarCierreMesInventario, getConciliacionPedidosVsSalidas, getAuditoriaOrdenPedidoSalida, guardarCuadreManualPedidoSalida, getOrCrearActaCruce, corregirLineaActaCruce, firmarActaCruce, getProductosInventario, getConteoFisicoDelMes } from "@/lib/sig-actions"
import { Truck, Loader2, Boxes, TrendingDown, ArrowDownToLine, AlertTriangle, RefreshCw, CalendarClock, Layers, FileText, BookOpen, ZoomIn, ClipboardList, ShieldAlert, FolderOpen, ExternalLink, CheckCircle2 } from "lucide-react"
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts"

const DONUT_COLORS = ["#1E8449", "#0D3B6E", "#00B4CC", "#E0A800", "#7e57c2", "#C0392B"]

function KPI({ label, valor, unidad, Icon, color, sub }: { label: string; valor: number | string; unidad?: string; Icon: any; color: string; sub?: string }) {
  return <SigKpi label={label} value={valor} unit={unidad} Icon={Icon} accent={color} valueColor={color} sub={sub} />
}

// Fecha calendario en hora Colombia (invtrans.creado está en UTC, 5h
// adelante) — mismo criterio que fechaColombiaDe en el servidor: un
// movimiento de las 8pm debe mostrarse con SU día, no el del UTC.
const fechaColombiaUI = (iso: any): string => {
  if (!iso) return ""
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(String(iso)))
  } catch {
    return String(iso).slice(0, 10)
  }
}

export function PanelInventarioLIP() {
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre, user, profile } = useAuth()
  const actor = (profile as any)?.nombre || (profile as any)?.usuario || user?.email || "usuario LIPgo"
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // Año/mes en curso por defecto (no "todo el año"): así la primera carga
  // del panel ya filtra en la consulta SQL en vez de traer el histórico
  // completo de invtrans y descartarlo en el navegador — ver
  // getPanelInventarioLIP, que ahora acota la consulta por estas fechas.
  const hoyDefault = new Date()
  const [anio, setAnio] = useState<string>(String(hoyDefault.getFullYear()))
  const [mes, setMes] = useState<string>(String(hoyDefault.getMonth() + 1).padStart(2, "0"))
  const [kardex, setKardex] = useState<any[]>([])
  // Base fija y cierre del periodo que explican el Kardex (Conteo total aprobado / sistema al corte / stock vivo).
  const [kardexInfo, setKardexInfo] = useState<{ base: { fecha: string; descripcion: string } | null; cierre: { fecha: string | null; descripcion: string; esVivo: boolean } } | null>(null)
  const [cuadreInfo, setCuadreInfo] = useState<{ base: { fecha: string | null; descripcion: string; saldo: number } | null; cierre?: { descripcion: string; esVivo: boolean; saldo: number }; saldoFinalCalculado?: number } | null>(null)
  const [loadingKardex, setLoadingKardex] = useState(false)
  const [filtroProd, setFiltroProd] = useState<string>("")
  const [drill, setDrill] = useState<{
    producto: string
    movs: any[]
    saldoInicialPeriodo?: number
    saldoFinalPeriodo?: number
    saldoCierre?: number
    descuadre?: number
    baseDescripcion?: string | null
    cierreDescripcion?: string
    resumen?: { entradas: number; salidas: number; traslados: number; ajustes: number; merma: number }
  } | null>(null)
  const [loadingDrill, setLoadingDrill] = useState(false)
  const [tiposMov, setTiposMov] = useState<any[]>([])
  const [verNomenclatura, setVerNomenclatura] = useState(false)
  const [cuadreD, setCuadreD] = useState<any[]>([])
  const [loadingCD, setLoadingCD] = useState(false)
  const [pres, setPres] = useState<any>(null)
  const [loadingPres, setLoadingPres] = useState(false)
  const [conc, setConc] = useState<{ filas: any[]; cierres: any[]; resumen?: any } | null>(null)
  const [loadingConc, setLoadingConc] = useState(false)
  const [generandoActa, setGenerandoActa] = useState<string | null>(null)
  const [actaSign, setActaSign] = useState<any | null>(null) // fila del mes a cerrar/firmar
  const [firmanteNom, setFirmanteNom] = useState("")
  const [firmanteCargo, setFirmanteCargo] = useState("")
  const firmaActaRef = useRef<SignaturePadHandle | null>(null)
  const [pedSal, setPedSal] = useState<{ filas: any[]; resumen: any } | null>(null)
  const [loadingPedSal, setLoadingPedSal] = useState(false)
  const [filtroAlerta, setFiltroAlerta] = useState("DISC") // DISC | "" (todas) | OK | CANTIDAD_DIFERENTE | PEDIDO_SIN_SALIDA | SALIDA_SIN_PEDIDO
  const [filtroOrden, setFiltroOrden] = useState("")
  const [auditoria, setAuditoria] = useState<{ ocargue: string; producto?: string; data: any } | null>(null)
  const [loadingAud, setLoadingAud] = useState(false)
  const [modoEdicion, setModoEdicion] = useState(false)
  // Ciclo completo de una orden (pidió · asignó · despachó), abierto desde la conciliación.
  const [orden360, setOrden360] = useState<string | null>(null)
  // Cuadre manual con clave personal (gerencia 2026-10-04): líneas pendientes de confirmar.
  const [pendienteCuadre, setPendienteCuadre] = useState<any[] | null>(null)
  const [claveCuadre, setClaveCuadre] = useState("")
  const [errorClaveCuadre, setErrorClaveCuadre] = useState("")
  const [edits, setEdits] = useState<{ ped: Record<number, string>; pedU: Record<number, string> }>({ ped: {}, pedU: {} })
  const [savingCuadre, setSavingCuadre] = useState(false)
  const [tab, setTab] = useState("dashboard")
  const [cruce, setCruce] = useState<{ acta: any; detalle: any[] } | null>(null)
  const [loadingCruce, setLoadingCruce] = useState(false)
  const [cruceBusqueda, setCruceBusqueda] = useState("")
  const [cruceLote, setCruceLote] = useState("")
  const [cruceSoloCorregidos, setCruceSoloCorregidos] = useState(false)
  const [corrigiendo, setCorrigiendo] = useState<{ detalleId: number; codproducto: string; producto: string; sistemaOriginal: number; nuevoValor: string; location: string; lote: string; motivo: string } | null>(null)
  const [ubicacionesProd, setUbicacionesProd] = useState<string[]>([])
  const [savingCorreccion, setSavingCorreccion] = useState(false)
  const [firmandoCruce, setFirmandoCruce] = useState(false)
  const [firmanteCruceNom, setFirmanteCruceNom] = useState("")
  const [firmanteCruceCargo, setFirmanteCruceCargo] = useState("")
  const firmaCruceRef = useRef<SignaturePadHandle | null>(null)

  const MESES = [
    { v: "", l: "Todo el año" }, { v: "01", l: "Enero" }, { v: "02", l: "Febrero" }, { v: "03", l: "Marzo" },
    { v: "04", l: "Abril" }, { v: "05", l: "Mayo" }, { v: "06", l: "Junio" }, { v: "07", l: "Julio" },
    { v: "08", l: "Agosto" }, { v: "09", l: "Septiembre" }, { v: "10", l: "Octubre" }, { v: "11", l: "Noviembre" }, { v: "12", l: "Diciembre" },
  ]

  useEffect(() => {
    let cancel = false
    setLoading(true)
    // El cliente/sitio lo define el SELECTOR GLOBAL (conector).
    getPanelInventarioLIP(selectedEmpresaId ?? null, anio || null, mes || null).then((r) => {
      if (cancel) return
      if (r.success) {
        setData(r.data)
        if (!anio && r.data?.anio) setAnio(r.data.anio)
      } else toast({ title: "No se pudo cargar el panel", description: r.error })
      setLoading(false)
    }).catch((e: any) => {
      // Sin este catch, si la acción del servidor falla (tiempo agotado, red),
      // la promesa quedaba rechazada sin manejar y el panel se quedaba en el
      // spinner para siempre ("no me cargan los datos", 2026-10-02).
      if (cancel) return
      toast({ title: "No se pudo cargar el panel", description: e?.message || "Error de red o tiempo agotado. Intenta de nuevo." })
      setLoading(false)
    })
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId, anio, mes])

  // Las pestañas distintas a "Dashboard" recargan al cambiar el selector global,
  // el año o el mes (antes solo cargaban al hacer clic → mostraban datos viejos).
  useEffect(() => {
    if (tab === "kardex") cargarKardex()
    else if (tab === "diario") cargarCuadreDiario()
    else if (tab === "preservacion") cargarPreservacion()
    else if (tab === "conciliacion") cargarConciliacion()
    else if (tab === "pedidos_salidas") cargarPedidosSalidas()
    else if (tab === "cruce") cargarCruce()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedEmpresaId, anio, mes])

  async function cargarKardex() {
    setLoadingKardex(true)
    const r = await getKardexInventario(selectedEmpresaId ?? null, anio || null, mes || null)
    if (r.success) {
      setKardex(r.data.filas)
      setKardexInfo({ base: r.data.base ?? null, cierre: r.data.cierre })
    } else toast({ title: "No se pudo cargar el kardex", description: r.error })
    setLoadingKardex(false)
  }

  async function abrirDrill(p: any) {
    // El resumen (Entradas/Salidas/Traslados/Ajustes/Merma) sale del MISMO
    // cálculo ya hecho por getKardexInventario para esta fila — no se
    // recalcula sumando `movs`, para que el total mostrado aquí sea
    // exactamente el mismo número que ya se ve en la fila de la tabla.
    const resumen = { entradas: p.entradas ?? 0, salidas: p.salidas ?? 0, traslados: p.traslados ?? 0, ajustes: p.ajustes ?? 0, merma: p.merma ?? 0 }
    setDrill({ producto: `${p.producto} (${p.codproducto})`, movs: [], resumen })
    setLoadingDrill(true)
    const r = await getMovimientosProducto(p.codproducto, selectedEmpresaId ?? null, anio || null, mes || null)
    setLoadingDrill(false)
    if (r.success) {
      setDrill({
        producto: `${p.producto} (${p.codproducto})`,
        movs: r.data,
        saldoInicialPeriodo: r.saldoInicialPeriodo,
        saldoFinalPeriodo: r.saldoFinalPeriodo,
        saldoCierre: r.saldoCierre,
        descuadre: r.descuadre,
        baseDescripcion: r.baseDescripcion,
        cierreDescripcion: r.cierreDescripcion,
        resumen,
      })
    } else toast({ title: "No se pudo cargar el detalle", description: r.error })
  }

  async function abrirNomenclatura() {
    setVerNomenclatura(true)
    if (tiposMov.length === 0) {
      const r = await getTiposMovimiento()
      if (r.success) setTiposMov(r.data)
    }
  }

  async function cargarCuadreDiario() {
    setLoadingCD(true)
    const r = await getCuadreDiario(selectedEmpresaId ?? null, anio || null, mes || null)
    if (r.success) {
      setCuadreD(r.data)
      setCuadreInfo({ base: r.base ?? null, cierre: r.cierre, saldoFinalCalculado: r.saldoFinalCalculado })
    } else toast({ title: "No se pudo cargar el cuadre diario", description: r.error })
    setLoadingCD(false)
  }
  async function cargarPreservacion() {
    setLoadingPres(true)
    const r = await getPreservacionInventario(selectedEmpresaId ?? null)
    if (r.success) setPres(r.data)
    else toast({ title: "No se pudo cargar preservación", description: r.error })
    setLoadingPres(false)
  }
  async function cargarConciliacion() {
    if (!selectedEmpresaId) {
      setConc(null)
      return
    }
    setLoadingConc(true)
    const r = await getConciliacionMensualInventario(selectedEmpresaId, anio || null)
    if (r.success) {
      setConc({ filas: r.data?.filas ?? [], cierres: r.data?.cierres ?? [], resumen: r.data?.resumen })
      if (!anio && r.data?.anio) setAnio(r.data.anio)
    } else {
      setConc(null)
      toast({ title: "No se pudo cargar la conciliación", description: r.error })
    }
    setLoadingConc(false)
  }
  async function cargarCruce() {
    if (!selectedEmpresaId) {
      setCruce(null)
      return
    }
    setLoadingCruce(true)
    // Mes calendario de COLOMBIA — en UTC, desde las 7pm del último día del
    // mes se crearía el acta del mes siguiente antes de tiempo.
    const mesActualCruce = fechaColombiaUI(new Date().toISOString()).slice(0, 7)
    const r = await getOrCrearActaCruce(selectedEmpresaId, mesActualCruce)
    if (r.success) setCruce({ acta: r.acta, detalle: r.detalle ?? [] })
    else {
      setCruce(null)
      toast({ title: "No se pudo cargar el acta de cruce", description: r.error })
    }
    setLoadingCruce(false)
  }

  async function abrirCorregir(d: any) {
    setCorrigiendo({
      detalleId: d.id,
      codproducto: d.codproducto,
      producto: d.producto || d.codproducto,
      sistemaOriginal: Number(d.sistema_original) || 0,
      nuevoValor: String(d.fisico_actual ?? d.sistema_original ?? 0),
      location: d.location || "",
      lote: d.lote || "",
      motivo: "",
    })
    setUbicacionesProd([])
    if (selectedEmpresaId) {
      const r = await getProductosInventario(selectedEmpresaId)
      if (r.success) {
        const p = r.data.find((x) => x.codproducto === d.codproducto)
        setUbicacionesProd(p?.locations ?? [])
      }
    }
  }

  async function guardarCorreccion() {
    if (!corrigiendo) return
    const nuevo = Number(corrigiendo.nuevoValor)
    if (!Number.isFinite(nuevo)) { toast({ title: "Valor inválido" }); return }
    if (nuevo === corrigiendo.sistemaOriginal) { toast({ title: "El valor no cambió", description: "Nada que corregir." }); return }
    if (!corrigiendo.location.trim()) { toast({ title: "Indica la ubicación", description: "Dónde queda registrada la corrección." }); return }
    if (!corrigiendo.motivo.trim()) { toast({ title: "Indica el motivo de la corrección" }); return }
    const diferencia = Math.round((nuevo - corrigiendo.sistemaOriginal) * 100) / 100
    const signo = diferencia < 0 ? "salida (descuenta stock)" : "entrada (suma stock)"
    if (!window.confirm(`Vas a CORREGIR ${corrigiendo.producto} de ${fmt(corrigiendo.sistemaOriginal)} a ${fmt(nuevo)}.\n\nSe generará un movimiento real de ${signo} en el inventario (mueve el saldo real). Esta acción no se puede deshacer.\n\n¿Confirmar la corrección?`)) return
    setSavingCorreccion(true)
    const r = await corregirLineaActaCruce(corrigiendo.detalleId, {
      nuevoValor: nuevo,
      location: corrigiendo.location.trim(),
      lote: corrigiendo.lote.trim() || null,
      motivo: corrigiendo.motivo.trim(),
      actor,
    })
    setSavingCorreccion(false)
    if (r.success) {
      toast({ title: "Corrección aplicada", description: "El inventario quedó ajustado al valor corregido." })
      setCorrigiendo(null)
      cargarCruce()
    } else toast({ title: "No se pudo aplicar la corrección", description: r.error })
  }

  async function guardarFirmaCruce() {
    if (!cruce?.acta) return
    if (!firmaCruceRef.current || firmaCruceRef.current.isEmpty()) {
      toast({ title: "Falta la firma", description: "Dibuje la firma para cerrar el acta." })
      return
    }
    if (!firmanteCruceNom.trim()) {
      toast({ title: "Falta el firmante", description: "Escriba el nombre de quien firma." })
      return
    }
    setSavingCorreccion(true)
    try {
      const firmaBlob = await firmaCruceRef.current.toBlob()
      let firmaUrl: string | null = null
      if (firmaBlob) {
        const fd = new FormData()
        fd.append("file", firmaBlob, `firma-cruce-${cruce.acta.mes}.png`)
        const up = await fetch("/api/capacitaciones/upload-firma", { method: "POST", body: fd })
        const upJson = await up.json()
        if (!upJson?.url) throw new Error(upJson?.error || "No se pudo subir la firma")
        firmaUrl = upJson.url
      }
      const r = await firmarActaCruce(cruce.acta.id, {
        firmante: firmanteCruceNom.trim(),
        firmante_cargo: firmanteCruceCargo.trim() || null,
        firma_url: firmaUrl,
      })
      if (!r.success) throw new Error(r.error || "No se pudo firmar")
      toast({ title: "Acta de cruce firmada", description: `Firmado por ${firmanteCruceNom.trim()}` })
      setFirmandoCruce(false)
      cargarCruce()
    } catch (e: any) {
      toast({ title: "No se pudo firmar el acta", description: e?.message || "Error desconocido" })
    } finally {
      setSavingCorreccion(false)
    }
  }

  async function cargarPedidosSalidas() {
    if (!selectedEmpresaId) {
      setPedSal(null)
      return
    }
    setLoadingPedSal(true)
    const r = await getConciliacionPedidosVsSalidas(selectedEmpresaId)
    if (r.success) setPedSal({ filas: r.data?.filas ?? [], resumen: r.data?.resumen ?? {} })
    else {
      setPedSal(null)
      toast({ title: "No se pudo cargar pedidos vs salidas", description: r.error })
    }
    setLoadingPedSal(false)
  }
  async function abrirAuditoria(f: any) {
    setModoEdicion(false)
    setEdits({ ped: {}, pedU: {} })
    setAuditoria({ ocargue: f.ocargue, producto: f.producto, data: null })
    setLoadingAud(true)
    const r = await getAuditoriaOrdenPedidoSalida(f.ocargue)
    setLoadingAud(false)
    if (r.success) setAuditoria({ ocargue: f.ocargue, producto: f.producto, data: r.data })
    else {
      setAuditoria(null)
      toast({ title: "No se pudo cargar la auditoría", description: r.error })
    }
  }
  async function guardarCuadre() {
    if (!auditoria?.data) return
    const peds = (auditoria.data.pedidos ?? [])
      .map((r: any) => {
        const out: any = { transid: r.transid }
        let changed = false
        if (edits.ped[r.transid] !== undefined && edits.ped[r.transid] !== "" && Number(edits.ped[r.transid]) !== Number(r.cargadas)) { out.cargadas = Number(edits.ped[r.transid]); changed = true }
        if (edits.pedU[r.transid] !== undefined && edits.pedU[r.transid] !== "" && Number(edits.pedU[r.transid]) !== Number(r.unidades)) { out.unidades = Number(edits.pedU[r.transid]); changed = true }
        return changed ? out : null
      })
      .filter(Boolean)
    if (peds.length === 0) {
      toast({ title: "Sin cambios", description: "No hay cantidades de pedido modificadas." })
      return
    }
    // Gerencia 2026-10-04: esta acción pide CLAVE. No toca el inventario físico, pero reescribe
    // el lado del pedido y con eso puede hacer desaparecer una diferencia de la conciliación.
    setPendienteCuadre(peds)
    setClaveCuadre("")
    setErrorClaveCuadre("")
  }

  /** Ejecuta el cuadre manual ya confirmado con la clave personal. */
  async function confirmarCuadreConClave() {
    if (!pendienteCuadre || !auditoria) return
    setSavingCuadre(true)
    const r = await guardarCuadreManualPedidoSalida({ pedidos: pendienteCuadre, actor, clave: claveCuadre, idempresa: selectedEmpresaId })
    setSavingCuadre(false)
    if (r.success) {
      toast({ title: "Cuadre manual guardado", description: `${r.data?.pedidos ?? 0} línea(s) de pedido actualizada(s). Queda registrado quién autorizó.` })
      setPendienteCuadre(null)
      setClaveCuadre("")
      setModoEdicion(false)
      setEdits({ ped: {}, pedU: {} })
      await abrirAuditoria({ ocargue: auditoria.ocargue, producto: auditoria.producto })
      cargarPedidosSalidas()
    } else {
      setErrorClaveCuadre(r.error || "No se pudo guardar el cuadre.")
    }
  }

  async function generarYGuardarActa(f: any) {
    if (!selectedEmpresaId) return
    // Requiere firma digital dibujada.
    if (!firmaActaRef.current || firmaActaRef.current.isEmpty()) {
      toast({ title: "Falta la firma", description: "Dibuje la firma para cerrar el acta." })
      return
    }
    if (!firmanteNom.trim()) {
      toast({ title: "Falta el firmante", description: "Escriba el nombre de quien firma." })
      return
    }
    setGenerandoActa(f.mes)
    try {
      // 1) Firma: subir PNG (archivos/firmas/) + dataURL para embeber en el PDF.
      const firmaBlob = await firmaActaRef.current.toBlob()
      let firmaUrl: string | null = null
      let firmaDataUrl: string | null = null
      if (firmaBlob) {
        const fdF = new FormData()
        fdF.append("file", firmaBlob, `firma-cierre-${f.mes}.png`)
        const upF = await fetch("/api/capacitaciones/upload-firma", { method: "POST", body: fdF })
        const upFJson = await upF.json()
        if (!upFJson?.url) throw new Error(upFJson?.error || "No se pudo subir la firma")
        firmaUrl = upFJson.url
        firmaDataUrl = await new Promise<string>((resolve) => {
          const r = new FileReader()
          r.onloadend = () => resolve(String(r.result || ""))
          r.readAsDataURL(firmaBlob)
        })
      }

      const { default: jsPDF } = await import("jspdf")
      const autoTable = (await import("jspdf-autotable")).default
      const doc = new jsPDF()
      const fmtN = (n: number) => (n ?? 0).toLocaleString("es-CO")
      doc.setFontSize(14)
      doc.text("ACTA DE CIERRE MENSUAL DE INVENTARIO", 14, 18)
      doc.setFontSize(10)
      doc.text(`Cliente / sitio: ${selectedEmpresaNombre || "—"}`, 14, 27)
      doc.text(`Periodo: ${f.mes}`, 14, 33)
      doc.text(`Generado: ${new Date().toLocaleDateString("es-CO")} · ${actor}`, 14, 39)
      autoTable(doc, {
        startY: 46,
        head: [["Concepto", "Unidades"]],
        body: [
          ["Saldo inicial (inventario inicial / cierre mes anterior)", fmtN(f.saldoInicial)],
          ["(+) Ingresos (producción / descargue + devoluciones)", fmtN(f.ingresos)],
          ["      Producción / recepción", fmtN(f.recepcion ?? f.produccion ?? 0)],
          ["      Devoluciones", fmtN(f.devolucion ?? 0)],
          ["(−) Órdenes de cargue (601)", fmtN(f.cargue)],
          ["(−) Merma de proceso — reproceso / avería (551)", fmtN(f.reproceso ?? 0)],
          ["(−) Ajuste / depuración (cuadre físico por lote)", fmtN(f.mermaProceso ?? 0)],
          ["(=) Saldo final conciliado (= stock físico)", fmtN(f.saldoFinal)],
        ],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [13, 59, 110] },
      })
      let y = (doc as any).lastAutoTable.finalY + 8
      doc.setFontSize(9)
      doc.text("El inventario y los despachos se llevan por lote. La merma de proceso (reproceso +", 14, y)
      doc.text("cuadre físico por lote) se documenta en el cierre; NO se cobra a LIP. El saldo final", 14, y + 5)
      doc.text("conciliado coincide con el stock físico del sistema (saldoinvdetalle).", 14, y + 10)
      y += 14
      // Firma digital LIP (izquierda) + espacio para firma del cliente (derecha).
      if (firmaDataUrl) {
        try { doc.addImage(firmaDataUrl, "PNG", 22, y, 55, 22) } catch { /* ignora si el formato falla */ }
      }
      doc.line(20, y + 24, 90, y + 24)
      doc.line(120, y + 24, 190, y + 24)
      doc.setFontSize(9)
      doc.text(`Firma LIP — ${firmanteNom}`, 20, y + 29)
      if (firmanteCargo.trim()) doc.text(firmanteCargo, 20, y + 33)
      doc.text(`Firmado digitalmente · ${new Date().toLocaleString("es-CO")}`, 20, y + (firmanteCargo.trim() ? 37 : 33))
      doc.text("Firma Cliente", 145, y + 29)

      const blob = doc.output("blob")
      const fd = new FormData()
      fd.append("file", blob, `acta-conciliacion-${f.mes}.pdf`)
      fd.append("proyectoId", String(selectedEmpresaId))
      fd.append("mes", f.mes)
      const up = await fetch("/api/inventario/cierre-upload", { method: "POST", body: fd })
      const upJson = await up.json()
      if (!upJson.success) throw new Error(upJson.error || "Error al subir PDF")

      // Si ya se hizo un conteo físico de fin de mes en "Cuadre y
      // Correcciones" (cerrado/aprobado) para este proyecto/mes, ese conteo
      // real queda como el "físico congelado" que abre el mes siguiente —
      // sin esto, Acta de Cruce/Kardex solo verían un cierre sin conteo real
      // detrás (el hueco que antes solo se llenaba con un script manual).
      const conteoFisico = await getConteoFisicoDelMes(selectedEmpresaId, f.mes)
      const fisico = conteoFisico.success ? conteoFisico.data : null

      const save = await guardarCierreMesInventario({
        proyecto_id: selectedEmpresaId,
        mes: f.mes,
        saldo_inicial: f.saldoInicial,
        ingresos: f.ingresos,
        cargue: f.cargue,
        merma: f.merma,
        salidas: f.salidas,
        saldo_final: f.saldoFinal,
        faltante: f.faltante,
        ajuste: f.ajuste,
        produccion: f.recepcion ?? f.produccion ?? 0,
        devolucion: f.devolucion ?? 0,
        documento_url: upJson.url,
        cerrado_por: actor,
        firmante: firmanteNom.trim(),
        firmante_cargo: firmanteCargo.trim() || null,
        firma_url: firmaUrl,
        fisico_congelado: fisico?.fisicoCongelado ?? null,
        fisico_snapshot: fisico?.fisicoSnapshot ?? null,
        observaciones: `Merma de proceso: reproceso 551 = ${fmt(f.reproceso ?? 0)}, cuadre físico por lote = ${fmt(f.mermaProceso ?? 0)}. Saldo final conciliado = stock físico. Firmado por ${firmanteNom.trim()}${firmanteCargo.trim() ? " (" + firmanteCargo.trim() + ")" : ""}.${fisico ? " Inventario inicial del mes siguiente = conteo físico real de este cierre." : ""}`,
      })
      if (!save.success) throw new Error(save.error || "Error al guardar cierre")

      toast({
        title: "Acta firmada y guardada",
        description: fisico
          ? `Cierre ${f.mes} · firmado por ${firmanteNom.trim()} · conteo físico real enlazado como inventario inicial del siguiente mes`
          : `Cierre ${f.mes} · firmado por ${firmanteNom.trim()} (sin conteo físico de esta pantalla — el mes siguiente arranca calculado, no contado)`,
      })
      setActaSign(null)
      await cargarConciliacion()
    } catch (e: any) {
      toast({ title: "No se pudo generar el acta", description: e?.message || "Error desconocido" })
    } finally {
      setGenerandoActa(null)
    }
  }

  const concFilas = conc?.filas ?? []
  const concCierres = conc?.cierres ?? []
  const k = data?.kpis
  const colorExact = (v: number) => (v >= 98 ? SST_TOKENS.ok : v >= 95 ? SST_TOKENS.warn : SST_TOKENS.bad)
  const fmt = (n: number) => (n ?? 0).toLocaleString("es-CO")
  const mesActual = fechaColombiaUI(new Date().toISOString()).slice(0, 7) // "AAAA-MM" hora Colombia — solo este mes queda pendiente

  return (
    <div className="space-y-5">
      <SigHeader
        Icon={Boxes}
        title="Panel LIP · Inventario — Exactitud y merma"
        subtitle={<>Cuadre y exactitud de inventario · ISO 9001 8.5.1 — por año y mes a mes, por cliente/sitio. Las diferencias se concilian contra los movimientos; lo que reste se ajusta con documento soporte.</>}
      />

      <SigFilterBar cliente={selectedEmpresaNombre}>
        <SigField label="Año">
          <select value={anio} onChange={(e) => setAnio(e.target.value)} className={sigControl}>
            {(data?.anios ?? []).map((a: string) => (<option key={a} value={a}>{a}</option>))}
          </select>
        </SigField>
        <SigField label="Mes">
          <select value={mes} onChange={(e) => setMes(e.target.value)} className={sigControl}>
            {MESES.map((m) => (<option key={m.v} value={m.v}>{m.l}</option>))}
          </select>
        </SigField>
        {loading && <Loader2 className="h-4 w-4 animate-spin" style={{ color: SST_TOKENS.teal }} />}
      </SigFilterBar>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="conciliacion">Conciliación mensual</TabsTrigger>
          <TabsTrigger value="kardex">Inventario detalle (Kardex)</TabsTrigger>
          <TabsTrigger value="diario">Cuadre diario</TabsTrigger>
          <TabsTrigger value="preservacion">Preservación / FIFO</TabsTrigger>
          <TabsTrigger value="pedidos_salidas">Conciliación pedidos vs salidas</TabsTrigger>
          <TabsTrigger value="cruce">Acta de Cruce (apertura de mes)</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-5 pt-3">
      {!data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: SST_TOKENS.navy }} />
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={abrirNomenclatura}>
              <BookOpen className="mr-1 h-4 w-4" /> Nomenclatura de movimientos
            </Button>
          </div>

          {/* KPIs de gestión de almacén (alto nivel) */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KPI label="ERI — Exactitud de registro" valor={k.eri === null || k.eri === undefined ? "—" : k.eri} unidad={k.eri === null || k.eri === undefined ? undefined : "%"} Icon={Boxes} color={k.eri === null || k.eri === undefined ? SST_TOKENS.navy : colorExact(k.eri)} sub={k.eriBase || "conteos físicos aprobados"} />
            <KPI label="Rotación de inventario" valor={k.rotacion} unidad="x" Icon={RefreshCw} color={SST_TOKENS.navy} sub="despacho / stock" />
            <KPI label="Días de inventario" valor={fmt(k.diasInventario)} unidad="días" Icon={CalendarClock} color={k.diasInventario > 60 ? SST_TOKENS.warn : SST_TOKENS.ok} sub="cobertura de stock" />
            <KPI label="Stock (sistema)" valor={fmt(k.saldoFisico)} unidad="und" Icon={Boxes} color={SST_TOKENS.navy} sub={`${fmt(k.skusConStock)} SKUs con stock · stock vivo`} />
            <KPI label="SKUs activos" valor={fmt(k.skusActivos)} Icon={Layers} color={SST_TOKENS.navy} sub="con movimiento en el periodo" />
            <KPI label="SKUs sin movimiento" valor={fmt(k.skusSinMovimiento)} Icon={AlertTriangle} color={k.skusSinMovimiento ? SST_TOKENS.warn : SST_TOKENS.ok} sub="stock sin rotar (slow movers)" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KPI label="Faltante (conteo físico)" valor={fmt(k.faltante)} unidad="und" Icon={TrendingDown} color={k.faltante ? SST_TOKENS.bad : SST_TOKENS.ok} sub="dif. negativa del cuadre" />
            <KPI label="Sobrante" valor={fmt(k.sobrante)} unidad="und" Icon={ArrowDownToLine} color={SST_TOKENS.navy} sub="dif. positiva del conteo" />
            <KPI label="Movimientos del periodo" valor={fmt(k.movimientos)} unidad="und" Icon={Layers} color={SST_TOKENS.navy} />
            <KPI label="Merma de proceso (reproceso)" valor={fmt(k.mermaProceso)} unidad="und" Icon={AlertTriangle} color={SST_TOKENS.warn} sub="avería en proceso (551)" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-3">
              <h3 className="mb-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>Distribución de movimientos</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={data.movimientos.filter((m: any) => m.cant > 0)} dataKey="cant" nameKey="tipo" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.tipo?.split(" ")[0]}>
                    {data.movimientos.filter((m: any) => m.cant > 0).map((_: any, i: number) => (<Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-3 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>Top productos por salidas (fast movers)</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.topMovers} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="producto" tick={{ fontSize: 9 }} width={160} />
                  <Tooltip />
                  <Bar dataKey="salidas" name="Salidas (und)" fill={SST_TOKENS.navy} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-3">
              <h3 className="mb-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>Clasificación ABC (Pareto)</h3>
              <div className="space-y-2">
                {[
                  { c: "A", l: "Alto movimiento (≤80%)", v: data.abc.A, color: SST_TOKENS.ok },
                  { c: "B", l: "Medio (80–95%)", v: data.abc.B, color: SST_TOKENS.warn },
                  { c: "C", l: "Bajo / cola (95–100%)", v: data.abc.C, color: "#94a3b8" },
                ].map((x) => (
                  <div key={x.c} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm"><Badge style={{ background: x.color, color: "white" }}>{x.c}</Badge>{x.l}</span>
                    <span className="font-bold" style={{ color: x.color }}>{x.v} SKU</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-3 lg:col-span-2">
              <h3 className="mb-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>Recepción vs Despacho por mes ({data.anio})</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.porMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="recepcion" name="Recepción (101)" fill={SST_TOKENS.ok} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="despacho" name="Despacho (601)" fill={SST_TOKENS.navy} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card className="p-3">
            <p className="text-[11px] text-muted-foreground">
              <b>Una sola fuente:</b> el stock es el stock vivo que la base recalcula con cada transacción (recepción 101, despacho 601, traslado 311, ajuste 701/702, inicial 561, merma 551). El <b>Conteo total aprobado</b> es la base fija con la que arranca cada mes; Kardex, detalle y cuadre diario parten de ahí y avanzan transacción por transacción. <b>ERI</b> = ítems exactos / contados en los conteos físicos aprobados. <b>Rotación</b> = despacho/stock; <b>días de inventario</b> = cobertura. <b>ABC</b> = Pareto por salidas. <b>Ingresos</b> = aprobación de ingresos (producción / descargue) y devoluciones. <b>Salidas</b> = órdenes de cargue, averías y reprocesos. Los traslados internos no alteran el stock.
            </p>
          </Card>
        </>
      )}
        </TabsContent>

        {/* CONCILIACIÓN MENSUAL — depuración mes a mes (mes del código de orden) */}
        <TabsContent value="conciliacion" className="space-y-3 pt-3">
          {!selectedEmpresaId ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Seleccione un <b>cliente/sitio</b> en el selector global (ej. Avimol) para conciliar mes a mes y generar los soportes de cierre.
            </Card>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                <ClipboardList className="mr-1 inline h-3.5 w-3.5" />
                <b>{selectedEmpresaNombre}</b> · solo <b>Producto Terminado + Sub Producto</b> (el empaque y la materia prima se concilian aparte). <b>Saldo inicial</b> de cada mes = su <b>Conteo total aprobado</b> (si no hay, el sistema al corte del día 1). <b>Ingresos</b> = aprobación de ingresos + devoluciones · <b>Salidas</b> = cargue (601) + reproceso/avería (551) · <b>Ajustes</b> = 701/702. <b>Saldo final</b> = base del mes siguiente (stock vivo en el mes en curso). Todo por la fecha de cada transacción; la proyección no se cuenta (no es inventario) y los ingresos de producción por tolva sí. Lo que las transacciones no cubren queda en <b>"Sin soporte"</b> y debe llevarse a cero con su corrección documentada; nunca se fuerza el cuadre. Cada mes genera un acta PDF en <code>inventario/cierres/{selectedEmpresaId}/AAAA-MM/</code>.
              </p>
              {loadingConc ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
              ) : concFilas.length === 0 ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">Sin movimientos para el año seleccionado.</Card>
              ) : (
                <>
                {conc?.resumen && (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <KPI label="Saldo inicial del periodo" valor={fmt(conc.resumen.invInicial)} unidad="und" Icon={ArrowDownToLine} color={SST_TOKENS.navy} sub={concFilas[0]?.baseDescripcion || "base fija del primer mes"} />
                    <KPI label="Merma de proceso" valor={fmt(conc.resumen.mermaMesEnCurso ?? 0)} unidad="und" Icon={AlertTriangle} color={SST_TOKENS.warn} sub={`reproceso/avería · mes ${conc.resumen.mesMerma ?? "—"}`} />
                    <KPI
                      label="Sin soporte (meses cerrados)"
                      valor={fmt((conc.resumen.mermaProceso ?? 0) - (conc.resumen.ajusteMesEnCurso ?? 0))}
                      unidad="und"
                      Icon={RefreshCw}
                      color={(conc.resumen.mermaProceso ?? 0) - (conc.resumen.ajusteMesEnCurso ?? 0) === 0 ? SST_TOKENS.ok : SST_TOKENS.bad}
                      sub={`mes en curso: ${fmt(conc.resumen.ajusteMesEnCurso ?? 0)} (frente al stock vivo de hoy)`}
                    />
                    <KPI label="Saldo por transacciones" valor={fmt(conc.resumen.saldoTeorico)} unidad="und" Icon={Boxes} color={SST_TOKENS.navy} sub="cierre del último mes" />
                    <KPI label="Stock vivo (sistema)" valor={fmt(conc.resumen.saldoVivo)} unidad="und" Icon={Boxes} color={SST_TOKENS.ok} sub="saldoinvdetalle · PT + SP" />
                    <KPI label="Lotes a revisar" valor={fmt(conc.resumen.lotesRevisar ?? 0)} Icon={TrendingDown} color={(conc.resumen.lotesRevisar ?? 0) ? SST_TOKENS.bad : SST_TOKENS.ok} sub="libro vs stock por lote, |dif| > 100" />
                  </div>
                )}
                <Card className="overflow-hidden">
                  <div className="max-h-[60vh] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                          <th className="px-3 py-2">Mes</th>
                          <th className="px-3 py-2">Estado</th>
                          <th className="px-3 py-2 text-right">Saldo inicial</th>
                          <th className="px-3 py-2 text-right">Ingresos</th>
                          <th className="px-3 py-2 text-right">Cargue (601)</th>
                          <th className="px-3 py-2 text-right">Reproceso (551)</th>
                          <th className="px-3 py-2 text-right">Ajustes y reclasif.</th>
                          <th className="px-3 py-2 text-right" title="Debe ser 0: toda diferencia debe quedar soportada con su corrección">Sin soporte</th>
                          <th className="px-3 py-2 text-right">Saldo final</th>
                          <th className="px-3 py-2 text-center">Soporte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {concFilas.map((f) => (
                          <tr key={f.mes} className="border-b last:border-0">
                            <td className="px-3 py-1.5 font-medium">{f.mes}</td>
                            <td className="px-3 py-1.5">
                              {f.documento_url ? (
                                <Badge style={{ background: SST_TOKENS.ok, color: "white" }}>Conciliado</Badge>
                              ) : f.mes >= mesActual ? (
                                <Badge style={{ background: SST_TOKENS.warn, color: "white" }}>Pendiente</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">Sin acta</Badge>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground" title={f.baseDescripcion || ""}>{fmt(f.saldoInicial)}</td>
                            <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.ok }} title={`Prod./recepción ${fmt(f.recepcion ?? 0)} · Dev. ${fmt(f.devolucion ?? 0)}${f.inicial ? ` · Inicial 561 ${fmt(f.inicial)}` : ""}`}>{fmt(f.ingresos)}</td>
                            <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.navy }}>{fmt(f.cargue)}</td>
                            <td className="px-3 py-1.5 text-right" style={{ color: (f.reproceso ?? 0) ? SST_TOKENS.warn : "inherit" }} title="Reproceso / avería registrada (mov 551) — merma real de proceso">{fmt(f.reproceso)}</td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground" title="Ajustes 701/702 y reclasificaciones 309 aprobados en el mes (con signo)">{fmt(f.ajuste ?? 0)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold" style={{ color: f.mermaProceso ? SST_TOKENS.bad : SST_TOKENS.ok }} title="Saldo inicial + ingresos + ajustes − cargue − reproceso − saldo final. Debe ser 0: salidas sin confirmar o diferencia que falta corregir con su soporte">{f.mermaProceso ? fmt(f.mermaProceso) : "✓"}</td>
                            <td className="px-3 py-1.5 text-right font-semibold" title={f.cierreDescripcion || ""}>{fmt(f.saldoFinal)}</td>
                            <td className="px-3 py-1.5 text-center">
                              {f.documento_url ? (
                                <a href={f.documento_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] hover:underline" style={{ color: SST_TOKENS.navy }}>
                                  <ExternalLink className="h-3.5 w-3.5" /> Ver PDF
                                </a>
                              ) : (
                                <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => { setActaSign(f); setFirmanteNom(actor); setFirmanteCargo("") }}>
                                  <FileText className="h-3.5 w-3.5" /> Firmar y cerrar
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
                </>
              )}

              {concCierres.length > 0 && (
                <Card className="p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: SST_TOKENS.ink }}>
                    <FolderOpen className="h-4 w-4" style={{ color: SST_TOKENS.navy }} />
                    Carpeta de cierres de mes · {selectedEmpresaNombre}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {concCierres.map((c: any) => (
                      c.documento_url ? (
                        <a key={c.mes} href={c.documento_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted/50" style={{ color: SST_TOKENS.navy }}>
                          <FileText className="h-3 w-3" /> {c.mes}
                        </a>
                      ) : null
                    ))}
                  </div>
                </Card>
              )}

              <p className="text-[11px] text-muted-foreground">
                La <b>merma de proceso</b> (reproceso 551) se documenta en el cierre y NO se cobra a LIP. Una cifra en <b>"Sin soporte"</b> no se absorbe en el cálculo: señala salidas sin confirmar o una diferencia que falta registrar con su corrección y documento, y se corrige donde nació. Regenerar el acta sobrescribe el PDF en la carpeta del mes.
              </p>
            </>
          )}
        </TabsContent>

        {/* INVENTARIO DETALLE — Kardex por producto (movimiento total ingreso→salida) */}
        <TabsContent value="kardex" className="space-y-3 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Movimiento total de cada producto (ingreso → salida). {anio}{mes ? ` · mes ${mes}` : ""}
            </p>
            <Input value={filtroProd} onChange={(e) => setFiltroProd(e.target.value)} placeholder="Buscar producto/código" className="h-9 w-64" />
          </div>
          {kardexInfo && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span><span className="text-muted-foreground">Saldo inicial =</span> <b>{kardexInfo.base ? kardexInfo.base.descripcion : "sin periodo (acumulado histórico)"}</b></span>
              <span><span className="text-muted-foreground">Saldo =</span> inicial + entradas − salidas + ajustes − merma + reclasificaciones, transacción por transacción</span>
              <span><span className="text-muted-foreground">Stock al cierre =</span> <b>{kardexInfo.cierre?.descripcion}</b></span>
              <span><span className="text-muted-foreground">Sin soporte =</span> saldo − stock al cierre. Debe ser 0; si no, hay salidas sin confirmar o una diferencia que falta corregir con su soporte</span>
            </div>
          )}
          {loadingKardex ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
          ) : kardex.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin movimientos para el periodo seleccionado.</Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-3 py-2">Código</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2 text-right">Saldo inicial</th>
                      <th className="px-3 py-2 text-right">Entradas</th>
                      <th className="px-3 py-2 text-right">Salidas</th>
                      <th className="px-3 py-2 text-right" title="Reclasificaciones y traslados (309/311/312/343/344), neto: dentro del mismo producto suman 0">Reclasif. (neto)</th>
                      <th className="px-3 py-2 text-right">Ajustes</th>
                      <th className="px-3 py-2 text-right">Merma</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-right">Stock al cierre</th>
                      <th className="px-3 py-2 text-right" title="Saldo por transacciones − stock al cierre. Debe ser 0: toda diferencia debe quedar soportada con su corrección">Sin soporte</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {kardex
                      .filter((p) => !filtroProd || `${p.codproducto} ${p.producto}`.toLowerCase().includes(filtroProd.toLowerCase()))
                      .map((p) => (
                        <tr key={p.codproducto} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => abrirDrill(p)}>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.codproducto}</td>
                          <td className="px-3 py-1.5">{p.producto}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{p.saldoInicial === null ? "—" : fmt(p.saldoInicial)}</td>
                          <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.ok }}>{fmt(p.entradas)}</td>
                          <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.navy }}>{fmt(p.salidas)}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(p.traslados)}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(p.ajustes)}</td>
                          <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.warn }}>{fmt(p.merma)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold">{fmt(p.saldo)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{fmt(p.saldoCierre)}</td>
                          <td className="px-3 py-1.5 text-right font-semibold tabular-nums" style={{ color: p.descuadre ? SST_TOKENS.bad : SST_TOKENS.ok }} title={p.descuadre ? "Diferencia sin soporte: salidas sin confirmar (picking pendiente) o corrección que falta registrar con su documento" : "Cuadra"}>
                            {p.descuadre ? fmt(p.descuadre) : "✓"}
                          </td>
                          <td className="px-3 py-1.5 text-right"><ZoomIn className="h-3.5 w-3.5 text-muted-foreground" /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <p className="text-[11px] text-muted-foreground">Clic en un producto para ver sus movimientos y soportes (PDF de ingreso/aprobación y orden de cargue de cada salida).</p>
        </TabsContent>

        {/* CUADRE DIARIO — saldo inicial + ingresos − salidas = saldo final */}
        <TabsContent value="diario" className="space-y-3 pt-3">
          <p className="text-xs text-muted-foreground">
            <ClipboardList className="mr-1 inline h-3.5 w-3.5" />
            Control diario: <b>saldo inicial</b> (con que inicia el día) + <b>ingresos</b> (recepción/descargue/aprobación) − <b>salidas</b> (órdenes de cargue) = <b>saldo final</b>. {anio}{mes ? ` · mes ${mes}` : ""}
          </p>
          {cuadreInfo?.base && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span><span className="text-muted-foreground">Arranca en</span> <b>{fmt(cuadreInfo.base.saldo)}</b> <span className="text-muted-foreground">= {cuadreInfo.base.descripcion}</span></span>
              {cuadreInfo.cierre && !Number.isNaN(cuadreInfo.cierre.saldo) && (
                <span><span className="text-muted-foreground">Cierra en</span> <b>{fmt(cuadreInfo.cierre.saldo)}</b> <span className="text-muted-foreground">= {cuadreInfo.cierre.descripcion}</span>{cuadreInfo.saldoFinalCalculado !== undefined && cuadreInfo.saldoFinalCalculado !== cuadreInfo.cierre.saldo && (<span className="ml-1 font-semibold" style={{ color: SST_TOKENS.bad }}>· sin soporte {fmt(cuadreInfo.saldoFinalCalculado - cuadreInfo.cierre.saldo)}</span>)}</span>
              )}
              {cuadreInfo.cierre?.esVivo && <span className="text-muted-foreground">Cierre = {cuadreInfo.cierre.descripcion}</span>}
            </div>
          )}
          {loadingCD ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
          ) : cuadreD.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin movimientos para el periodo. Tip: selecciona un mes para ver el detalle diario.</Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Saldo inicial</th>
                      <th className="px-3 py-2 text-right">Ingresos</th>
                      <th className="px-3 py-2 text-right">Salidas</th>
                      <th className="px-3 py-2 text-right">Otros</th>
                      <th className="px-3 py-2 text-right">Saldo final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuadreD.map((d) => (
                      <tr key={d.fecha} className="border-b last:border-0">
                        <td className="px-3 py-1.5 font-medium">{d.fecha}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(d.saldoInicial)}</td>
                        <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.ok }}>{fmt(d.ingresos)}</td>
                        <td className="px-3 py-1.5 text-right" style={{ color: SST_TOKENS.navy }}>{fmt(d.salidas)}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{fmt(d.otros)}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{fmt(d.saldoFinal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          <p className="text-[11px] text-muted-foreground">"Otros" = ajustes, inventario inicial y merma (afectan el saldo). Los traslados de ubicación no se incluyen (no cambian el stock del sitio).</p>
        </TabsContent>

        {/* PRESERVACIÓN / FIFO — antigüedad y próximos a vencer (ISO 8.5.4) */}
        <TabsContent value="preservacion" className="space-y-3 pt-3">
          {loadingPres ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
          ) : !pres ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Cargando…</Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KPI label="Vencidos / a carpar" valor={fmt(pres.resumen.vencidos)} Icon={ShieldAlert} color={pres.resumen.vencidos ? SST_TOKENS.bad : SST_TOKENS.ok} sub="superan vida útil" />
                <KPI label="Próximos a vencer" valor={fmt(pres.resumen.proximos)} Icon={CalendarClock} color={pres.resumen.proximos ? SST_TOKENS.warn : SST_TOKENS.ok} sub="≥70% de vida útil" />
                <KPI label="Antigüedad promedio" valor={fmt(pres.resumen.antiguedadProm)} unidad="días" Icon={CalendarClock} color={SST_TOKENS.navy} sub="en bodega" />
                <KPI label="Lotes con stock" valor={fmt(pres.resumen.total)} Icon={Layers} color={SST_TOKENS.navy} />
              </div>
              <Card className="overflow-hidden">
                <div className="max-h-[55vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                        <th className="px-3 py-2">Producto</th>
                        <th className="px-3 py-2">Lote</th>
                        <th className="px-3 py-2 text-right">Stock</th>
                        <th className="px-3 py-2 text-right">Días en bodega</th>
                        <th className="px-3 py-2 text-right">Vida útil</th>
                        <th className="px-3 py-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pres.filas.slice(0, 200).map((p: any, i: number) => {
                        const c = p.estado === "vencido" ? SST_TOKENS.bad : p.estado === "proximo" ? SST_TOKENS.warn : p.estado === "ok" ? SST_TOKENS.ok : "#94a3b8"
                        const lbl = p.estado === "vencido" ? "Vencido / carpar" : p.estado === "proximo" ? "Próximo" : p.estado === "ok" ? "OK" : "Sin vida útil"
                        return (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-3 py-1.5">{p.producto}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.lote}</td>
                            <td className="px-3 py-1.5 text-right">{fmt(p.stock)}</td>
                            <td className="px-3 py-1.5 text-right">{p.dias ?? "—"}</td>
                            <td className="px-3 py-1.5 text-right text-muted-foreground">{p.vidautil ?? "—"}</td>
                            <td className="px-3 py-1.5"><Badge style={{ background: c, color: "white" }}>{lbl}</Badge></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <p className="text-[11px] text-muted-foreground">FIFO: el sistema sugiere despachar el lote más antiguo primero (orden por lote). Vida útil = <code>productos.vidautildias</code> (p. ej. harina ~15 días → carpar). Antigüedad estimada desde la fecha del lote (AAAAMMDD). ISO 9001 8.5.4 (preservación).</p>
            </>
          )}
        </TabsContent>

        <TabsContent value="pedidos_salidas" className="space-y-3 pt-3">
          {!selectedEmpresaId ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Seleccione un cliente/sitio en el selector global para ver la conciliación.</Card>
          ) : loadingPedSal ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
          ) : !pedSal ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">Sin datos.</Card>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">
                Cruce por <b>orden de cargue + producto</b>: unidades <b>cargadas</b> en pedidos (<code>pedidosdetalle</code>) vs <b>salidas aprobadas</b> del inventario (<code>invtrans</code>, tipomov=Salida). Todo el histórico del proyecto. La única discrepancia real es <b>cantidad diferente</b> (cargado ≠ salido). Los <b>pedidos sin salida</b> y las <b>salidas sin pedido</b> se excluyen del análisis: son anomalías del montaje de la información (no es lógico un pedido sin su salida ni una salida sin su pedido), no diferencias de inventario.
              </p>

              {/* Banda de alerta */}
              {pedSal.resumen.conAlerta > 0 ? (
                <Card className="flex items-center gap-3 border-l-4 p-3" style={{ borderLeftColor: "#C0392B" }}>
                  <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: "#C0392B" }} />
                  <div className="text-sm">
                    <b>{pedSal.resumen.cantidadDiferente.toLocaleString("es-CO")}</b> combinaciones con <b>cantidad diferente</b> (lo cargado ≠ lo que salió del inventario) — única discrepancia real.
                  </div>
                </Card>
              ) : (
                <Card className="flex items-center gap-3 border-l-4 p-3" style={{ borderLeftColor: "#1E8449" }}>
                  <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: "#1E8449" }} />
                  <div className="text-sm">Sin discrepancias reales de inventario (cargadas = salidas).</div>
                </Card>
              )}

              {pedSal.resumen.pendienteDespacho > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Informativo (no es diferencia de inventario): <b>{pedSal.resumen.pendienteDespacho}</b> pendiente de despacho.
                </p>
              )}

              {pedSal.resumen.empresaDistinta > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  <b>{pedSal.resumen.empresaDistinta.toLocaleString("es-CO")}</b> coincidencias cruzaron de empresa (el pedido estaba en otro <code>id_empresa</code> pero el <code>ocargue</code> y el producto coinciden). Se conservó el <code>idempresa</code> de invtrans y se marcaron como coincidencia.
                </p>
              )}

              {/* KPIs */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                <KPI label="OK (cuadran)" valor={pedSal.resumen.ok} Icon={CheckCircle2} color="#1E8449" />
                <KPI label="Cantidad diferente" valor={pedSal.resumen.cantidadDiferente} Icon={AlertTriangle} color="#E0A800" />
                <KPI label="Pendiente despacho" valor={pedSal.resumen.pendienteDespacho ?? 0} Icon={CalendarClock} color="#0284c7" />
                <KPI label="Total cargadas" valor={(pedSal.resumen.totalCargadas || 0).toLocaleString("es-CO")} Icon={ClipboardList} color="#0D3B6E" />
                <KPI label="Total salidas" valor={(pedSal.resumen.totalSalidas || 0).toLocaleString("es-CO")} Icon={ArrowDownToLine} color="#00B4CC" />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <SigField label="Alerta">
                  <select value={filtroAlerta} onChange={(e) => setFiltroAlerta(e.target.value)} className={sigControl}>
                    <option value="DISC">Con discrepancia</option>
                    <option value="">Todas (incluye OK)</option>
                    <option value="OK">Solo OK (cuadran)</option>
                    <option value="CANTIDAD_DIFERENTE">Cantidad diferente</option>
                    <option value="PENDIENTE_DESPACHO">Pendiente de despacho</option>
                  </select>
                </SigField>
                <SigField label="Orden de cargue">
                  <Input value={filtroOrden} onChange={(e) => setFiltroOrden(e.target.value)} placeholder="Buscar ocargue…" className="h-9 w-48" />
                </SigField>
                {(filtroAlerta !== "DISC" || filtroOrden) && (
                  <Button variant="outline" size="sm" onClick={() => { setFiltroAlerta("DISC"); setFiltroOrden("") }}>Limpiar</Button>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">{pedSal.resumen.total.toLocaleString("es-CO")} combinaciones (ocargue × producto)</span>
              </div>

              {(() => {
                const q = filtroOrden.trim().toLowerCase()
                const base = pedSal.filas.filter((f) => {
                  if (filtroAlerta === "DISC") { if (f.estado_alerta !== "CANTIDAD_DIFERENTE") return false }
                  else if (filtroAlerta && f.estado_alerta !== filtroAlerta) return false
                  if (q && !String(f.ocargue || "").toLowerCase().includes(q)) return false
                  return true
                })
                const CAP = 5000
                const vista = base.slice(0, CAP)
                const badge = (e: string) => {
                  if (e === "OK") return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px]">OK</Badge>
                  if (e === "PENDIENTE_DESPACHO") return <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 text-[10px]">Pendiente despacho</Badge>
                  if (e === "CANTIDAD_DIFERENTE") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">Cantidad diferente</Badge>
                  if (e === "PEDIDO_SIN_SALIDA") return <Badge className="bg-indigo-100 text-indigo-800 hover:bg-indigo-100 text-[10px]" title="Pedido con orden de cargue pero sin salida aprobada: el producto NO ha salido, inventario intacto. Por ejecutar/despachar.">Por ejecutar</Badge>
                  return <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100 text-[10px]" title="Salió con orden de cargue/lote/aprobada; el pedido no existe (borrado). Informativa, no es diferencia.">Salida sin pedido (info)</Badge>
                }
                if (vista.length === 0) return <Card className="p-8 text-center text-sm text-muted-foreground">No hay registros para el filtro seleccionado.</Card>
                return (
                  <Card className="overflow-hidden">
                    <div className="max-h-[60vh] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                            <th className="px-2 py-2">Orden de cargue</th>
                            <th className="px-2 py-2">Producto</th>
                            <th className="px-2 py-2 text-right">Pedidas</th>
                            <th className="px-2 py-2 text-right">Cargadas</th>
                            <th className="px-2 py-2 text-right">Salida invtrans</th>
                            <th className="px-2 py-2 text-right">Diferencia</th>
                            <th className="px-2 py-2 text-center">Emp. pedido</th>
                            <th className="px-2 py-2 text-center">Emp. salida</th>
                            <th className="px-2 py-2">Alerta</th>
                            <th className="px-2 py-2 text-center">Auditar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vista.map((f, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="px-2 py-1.5 font-mono text-xs">{f.ocargue}</td>
                              <td className="px-2 py-1.5">
                                {f.producto}
                                {f.empresa_distinta && (
                                  <Badge className="ml-1 bg-sky-100 text-sky-800 hover:bg-sky-100 text-[9px]" title="Coincide con pedido en otra empresa">
                                    emp {f.idempresa_pedido}→{f.idempresa_salida}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right text-muted-foreground">{Number(f.ped_unidades || 0).toLocaleString("es-CO")}</td>
                              <td className="px-2 py-1.5 text-right">{Number(f.ped_cargadas || 0).toLocaleString("es-CO")}</td>
                              <td className="px-2 py-1.5 text-right">{Number(f.salida_qty || 0).toLocaleString("es-CO")}</td>
                              <td className="px-2 py-1.5 text-right font-medium" style={{ color: Number(f.diferencia) !== 0 ? "#C0392B" : "#1E8449" }}>{Number(f.diferencia || 0).toLocaleString("es-CO")}</td>
                              <td className="px-2 py-1.5 text-center text-xs">{f.idempresa_pedido ?? "—"}</td>
                              <td className="px-2 py-1.5 text-center text-xs" style={{ color: f.empresa_distinta ? "#0369a1" : undefined, fontWeight: f.empresa_distinta ? 600 : undefined }}>{f.idempresa_salida ?? "—"}</td>
                              <td className="px-2 py-1.5">{badge(f.estado_alerta)}</td>
                              <td className="px-2 py-1.5 text-center">
                                <span className="inline-flex items-center gap-0.5">
                                  {/* Ciclo completo de la orden: qué pidió, qué lotes se asignaron
                                      y qué se despachó. Es la vista que explica la diferencia. */}
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver el ciclo completo de esta orden (pidió · asignó · despachó)" onClick={() => setOrden360(String(f.ocargue))}>
                                    <Truck className="h-4 w-4" style={{ color: SST_TOKENS.navy }} />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" title="Auditar orden (pedido detalle + invtrans)" onClick={() => abrirAuditoria(f)}>
                                    <ZoomIn className="h-4 w-4" style={{ color: SST_TOKENS.navy }} />
                                  </Button>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="p-2 text-[11px] text-muted-foreground">
                      {base.length > vista.length
                        ? `Mostrando ${vista.length.toLocaleString("es-CO")} de ${base.length.toLocaleString("es-CO")} filas. Afina con el filtro de Alerta u Orden.`
                        : `${base.length.toLocaleString("es-CO")} filas.`}
                    </p>
                  </Card>
                )
              })()}
            </>
          )}
        </TabsContent>

        <TabsContent value="cruce" className="space-y-3 pt-3">
          {!selectedEmpresaId ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Selecciona un cliente/sitio en el selector global.</p>
          ) : loadingCruce ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
          ) : !cruce?.acta ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay un cierre físico congelado del mes anterior para este proyecto — no hay cruce que armar todavía.</p>
          ) : (
            <>
              <Card className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: SST_TOKENS.navy }}>
                      Acta de Cruce · apertura de {cruce.acta.mes} · corte {String(cruce.acta.fecha_corte).slice(0, 10)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Inventario con el que ABRE el mes (antes de cualquier movimiento del mes), por lote y ubicación — retrocedido desde el stock vivo de hoy.
                      {" "}{cruce.detalle.length.toLocaleString("es-CO")} lote(s) · {cruce.detalle.filter((d: any) => d.corregido).length} corregido(s).
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={cargarCruce} disabled={loadingCruce}>
                      <RefreshCw className="mr-1 h-3.5 w-3.5" /> Actualizar
                    </Button>
                    {cruce.acta.estado === "firmado" ? (
                      <Badge variant="outline" className="gap-1" style={{ color: SST_TOKENS.ok, borderColor: SST_TOKENS.ok }}>
                        <CheckCircle2 className="h-3 w-3" /> Firmado · {cruce.acta.firmante}
                      </Badge>
                    ) : (
                      <Button size="sm" onClick={() => setFirmandoCruce(true)}>Firmar acta</Button>
                    )}
                  </div>
                </div>
              </Card>

              <Card className="flex flex-wrap items-end gap-3 p-3">
                <SigField label="Buscar producto / código">
                  <Input value={cruceBusqueda} onChange={(e) => setCruceBusqueda(e.target.value)} placeholder="Nombre o código" className="h-9 w-56" />
                </SigField>
                <SigField label="Lote">
                  <Input value={cruceLote} onChange={(e) => setCruceLote(e.target.value)} placeholder="Lote" className="h-9 w-36" />
                </SigField>
                <label className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={cruceSoloCorregidos} onChange={(e) => setCruceSoloCorregidos(e.target.checked)} />
                  Solo corregidos
                </label>
                {(cruceBusqueda || cruceLote || cruceSoloCorregidos) && (
                  <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setCruceBusqueda(""); setCruceLote(""); setCruceSoloCorregidos(false) }}>
                    Limpiar filtros
                  </Button>
                )}
              </Card>

              {(() => {
                const q = cruceBusqueda.trim().toLowerCase()
                const ql = cruceLote.trim().toLowerCase()
                const vista = cruce.detalle.filter((d: any) => {
                  if (q && !(String(d.producto || "").toLowerCase().includes(q) || String(d.codproducto || "").toLowerCase().includes(q))) return false
                  if (ql && !String(d.lote || "").toLowerCase().includes(ql)) return false
                  if (cruceSoloCorregidos && !d.corregido) return false
                  return true
                })
                return (
                  <Card className="overflow-hidden">
                    <div className="max-h-[60vh] overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-background">
                          <tr className="border-b text-left text-[11px] uppercase text-muted-foreground">
                            <th className="px-3 py-2">Producto</th>
                            <th className="px-3 py-2">Lote</th>
                            <th className="px-3 py-2">Ubicación</th>
                            <th className="px-3 py-2 text-right">Congelado (apertura)</th>
                            <th className="px-3 py-2 text-right">Valor vigente</th>
                            <th className="px-3 py-2 text-right">Diferencia</th>
                            <th className="px-3 py-2">Estado</th>
                            <th className="px-3 py-2 text-center">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vista.map((d: any) => (
                            <tr key={d.id} className="border-b last:border-0">
                              <td className="px-3 py-1.5">
                                <div className="font-medium">{d.producto || d.codproducto}</div>
                                <div className="text-[11px] text-muted-foreground">{d.codproducto}</div>
                              </td>
                              <td className="px-3 py-1.5 text-xs">{d.lote || "—"}</td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.location || "—"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmt(d.sistema_original)}</td>
                              <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{fmt(d.fisico_actual)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: Number(d.diferencia) !== 0 ? "#C0392B" : "#1E8449" }}>
                                {Number(d.diferencia) > 0 ? "+" : ""}{fmt(d.diferencia)}
                              </td>
                              <td className="px-3 py-1.5">
                                {d.corregido ? <Badge variant="outline" className="text-[10px]" style={{ color: "#C0392B", borderColor: "#C0392B" }}>Corregido</Badge> : <Badge variant="outline" className="text-[10px]">Sin cambios</Badge>}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => abrirCorregir(d)}>Corregir</Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="p-2 text-[11px] text-muted-foreground">
                      {cruce.detalle.length > vista.length
                        ? `Mostrando ${vista.length.toLocaleString("es-CO")} de ${cruce.detalle.length.toLocaleString("es-CO")} lotes. Afina con los filtros.`
                        : `${vista.length.toLocaleString("es-CO")} lote(s).`}
                    </p>
                  </Card>
                )
              })()}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ACTA DE CRUCE: corregir una línea (registra + aprueba el ajuste real) */}
      <Dialog open={!!corrigiendo} onOpenChange={(o) => !o && setCorrigiendo(null)}>
        <DialogContent className="max-w-md">
          {corrigiendo && (
            <>
              <DialogHeader><DialogTitle className="text-base">Corregir · {corrigiendo.producto}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  Congelado (apertura): <span className="font-semibold tabular-nums">{fmt(corrigiendo.sistemaOriginal)}</span>. Esta corrección se registra y aprueba de inmediato como movimiento real de inventario (mueve el stock).
                </p>
                <div>
                  <label className="text-[11px] uppercase text-muted-foreground">Valor correcto</label>
                  <Input type="number" value={corrigiendo.nuevoValor} onChange={(e) => setCorrigiendo({ ...corrigiendo, nuevoValor: e.target.value })} />
                </div>
                <div>
                  <label className="text-[11px] uppercase text-muted-foreground">Ubicación (dónde queda la corrección)</label>
                  <Input list="cruce-ubic" value={corrigiendo.location} onChange={(e) => setCorrigiendo({ ...corrigiendo, location: e.target.value })} placeholder="Ubicación" />
                  <datalist id="cruce-ubic">{ubicacionesProd.map((u) => <option key={u} value={u} />)}</datalist>
                </div>
                <div>
                  <label className="text-[11px] uppercase text-muted-foreground">Lote (opcional)</label>
                  <Input value={corrigiendo.lote} onChange={(e) => setCorrigiendo({ ...corrigiendo, lote: e.target.value })} placeholder="Lote" />
                </div>
                <div>
                  <label className="text-[11px] uppercase text-muted-foreground">Motivo</label>
                  <Input value={corrigiendo.motivo} onChange={(e) => setCorrigiendo({ ...corrigiendo, motivo: e.target.value })} placeholder="Por qué se corrige este valor" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCorrigiendo(null)}>Cancelar</Button>
                <Button onClick={guardarCorreccion} disabled={savingCorreccion}>{savingCorreccion ? "Guardando…" : "Aplicar corrección"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ACTA DE CRUCE: firma digital */}
      <Dialog open={firmandoCruce} onOpenChange={(o) => !o && setFirmandoCruce(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-base">Firmar Acta de Cruce · {cruce?.acta?.mes}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-[11px] uppercase text-muted-foreground">Nombre de quien firma</label>
              <Input value={firmanteCruceNom} onChange={(e) => setFirmanteCruceNom(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] uppercase text-muted-foreground">Cargo</label>
              <Input value={firmanteCruceCargo} onChange={(e) => setFirmanteCruceCargo(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] uppercase text-muted-foreground">Firma</label>
              <SignaturePad ref={firmaCruceRef} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFirmandoCruce(false)}>Cancelar</Button>
            <Button onClick={guardarFirmaCruce} disabled={savingCorreccion}>{savingCorreccion ? "Guardando…" : "Firmar y cerrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DRILL-DOWN: movimientos de un producto con soportes PDF */}
      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="overflow-y-auto" style={{ width: "95vw", maxWidth: "95vw", maxHeight: "95vh" }}>
          {drill && (
            <>
              <DialogHeader><DialogTitle className="text-base">Movimientos · {drill.producto}</DialogTitle></DialogHeader>
              {drill.resumen && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <SigKpi label="Entradas del periodo" value={fmt(drill.resumen.entradas)} accent={SST_TOKENS.ok} valueColor={SST_TOKENS.ok} />
                  <SigKpi label="Salidas del periodo" value={fmt(drill.resumen.salidas)} accent={SST_TOKENS.navy} valueColor={SST_TOKENS.navy} />
                  <SigKpi label="Traslados" value={fmt(drill.resumen.traslados)} accent={SST_TOKENS.ink} />
                  <SigKpi label="Ajustes" value={fmt(drill.resumen.ajustes)} accent={SST_TOKENS.ink} />
                  <SigKpi label="Merma" value={fmt(drill.resumen.merma)} accent={SST_TOKENS.warn} valueColor={SST_TOKENS.warn} />
                </div>
              )}
              {loadingDrill ? (
                <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
              ) : drill.movs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos en el periodo.</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Empezó con</span>
                    <span className="font-semibold tabular-nums">
                      {drill.saldoInicialPeriodo === undefined ? "— (sin periodo elegido)" : fmt(drill.saldoInicialPeriodo)}
                    </span>
                    <span className="text-muted-foreground">→ queda con</span>
                    <span className="font-semibold tabular-nums" style={{ color: SST_TOKENS.navy }}>
                      {drill.saldoFinalPeriodo === undefined ? "—" : fmt(drill.saldoFinalPeriodo)}
                    </span>
                    {drill.saldoCierre !== undefined && (
                      <>
                        <span className="text-muted-foreground">· stock al cierre</span>
                        <span className="font-semibold tabular-nums">{fmt(drill.saldoCierre)}</span>
                        {drill.descuadre ? (
                          <span className="font-semibold" style={{ color: SST_TOKENS.bad }}>· sin soporte {fmt(drill.descuadre)}</span>
                        ) : drill.descuadre === 0 ? (
                          <span className="font-semibold" style={{ color: SST_TOKENS.ok }}>· cuadra</span>
                        ) : null}
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {drill.baseDescripcion ? <>Base: <b>{drill.baseDescripcion}</b> · cierre: <b>{drill.cierreDescripcion}</b>. </> : null}
                    Saldo corrido único del producto, transacción por transacción — el lote y la ubicación de cada movimiento se ven en sus propias columnas (y en el soporte PDF), pero no cortan el hilo del saldo.
                  </p>
                  <div className="max-h-[78vh] overflow-auto rounded-md border">
                    <table className="w-full min-w-[1000px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
                          <th className="px-2 py-2">Fecha</th>
                          <th className="px-2 py-2">Movimiento</th>
                          <th className="px-2 py-2">Lote</th>
                          <th className="px-2 py-2">Ubicación</th>
                          <th className="px-2 py-2 text-right">Ingreso</th>
                          <th className="px-2 py-2 text-right">Salida</th>
                          <th className="px-2 py-2 text-right">Saldo</th>
                          <th className="px-2 py-2">Usuario</th>
                          <th className="px-2 py-2">Orden</th>
                          <th className="px-2 py-2">Soportes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...drill.movs]
                          .sort((a: any, b: any) => String(a.fecha || "").localeCompare(String(b.fecha || "")))
                          .map((mv: any, i: number) => (
                            <tr key={i} className="border-b last:border-0 align-top">
                              <td className="px-2 py-1.5 text-xs whitespace-nowrap">{fechaColombiaUI(mv.fecha)}</td>
                              <td className="px-2 py-1.5">
                                <Badge variant="outline" className="text-[10px]">{mv.tipo}</Badge>
                                {mv.netoCero && (
                                  <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">↔ {fmt(mv.cantidad)}</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs">{mv.lote || "—"}</td>
                              <td className="px-2 py-1.5 text-xs text-muted-foreground">{mv.location || "—"}</td>
                              <td className="px-2 py-1.5 text-right font-medium tabular-nums" style={{ color: SST_TOKENS.ok }} title={mv.netoCero ? "Traslado/reclasificación: no es un ingreso real, no cambia el total" : undefined}>
                                {!mv.netoCero && mv.tipomov === "Entrada" ? fmt(mv.cantidad) : ""}
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium tabular-nums" style={{ color: SST_TOKENS.bad }} title={mv.netoCero ? "Traslado/reclasificación: no es una salida real, no cambia el total" : undefined}>
                                {!mv.netoCero && mv.tipomov !== "Entrada" ? fmt(mv.cantidad) : ""}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums" title={mv.afectaSaldo ? undefined : "No aprobado: no afectó el saldo"}>
                                {mv.afectaSaldo ? (
                                  <span className="font-semibold">{fmt(mv.saldoDespues)}</span>
                                ) : (
                                  <span className="text-muted-foreground">{fmt(mv.saldoDespues)} *</span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs">{mv.usuario || "—"}</td>
                              <td className="px-2 py-1.5 text-xs text-muted-foreground">{mv.ocargue}</td>
                              <td className="px-2 py-1.5">
                                <span className="flex flex-wrap gap-2">
                                  {mv.pdf && <a href={mv.pdf} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:underline" style={{ color: SST_TOKENS.navy }}><FileText className="h-3 w-3" /> Ingreso</a>}
                                  {mv.pdfoc && <a href={mv.pdfoc} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:underline" style={{ color: SST_TOKENS.navy }}><FileText className="h-3 w-3" /> Orden</a>}
                                  {mv.doccargue && <a href={mv.doccargue} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs hover:underline" style={{ color: SST_TOKENS.navy }}><FileText className="h-3 w-3" /> Picking</a>}
                                  {!mv.pdf && !mv.pdfoc && !mv.doccargue && <span className="text-xs text-muted-foreground">—</span>}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-muted-foreground">* No aprobado (rechazado / lote paralelo) — no movió el saldo.</p>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* AUDITORÍA directa: pedidosdetalle + invtrans crudos de una orden */}
      <Dialog open={!!auditoria} onOpenChange={(o) => !o && setAuditoria(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Auditoría · orden <span className="font-mono">{auditoria?.ocargue}</span></DialogTitle>
          </DialogHeader>
          {loadingAud || !auditoria?.data ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin" style={{ color: SST_TOKENS.navy }} /></div>
          ) : (
            <div className="space-y-4">
              <p className="text-[11px] text-muted-foreground">Filas crudas de <code>pedidosdetalle</code> e <code>invtrans</code> para este ocargue (todas las empresas). El producto en foco: <b>{auditoria.producto}</b>.</p>

              <div className="flex flex-wrap items-center gap-2">
                {!modoEdicion ? (
                  <Button size="sm" variant="outline" onClick={() => setModoEdicion(true)}>Editar cantidades (cuadre manual)</Button>
                ) : (
                  <>
                    <Button size="sm" onClick={guardarCuadre} disabled={savingCuadre}>
                      {savingCuadre ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Guardar cuadre en Supabase
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setModoEdicion(false); setEdits({ ped: {}, pedU: {} }) }}>Cancelar</Button>
                  </>
                )}
              </div>
              {modoEdicion && (
                <div className="flex items-start gap-2 rounded-md border-l-4 bg-sky-50 p-2" style={{ borderLeftColor: "#0284c7" }}>
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#0284c7" }} />
                  <p className="text-[11px] text-sky-900">Corrección manual de <b>pedidos</b> (unidades pedidas y cargadas en <code>pedidosdetalle</code>). <b>NO modifica el inventario</b> de ningún proyecto — las salidas de <code>invtrans</code> son de solo lectura. Solo personal autorizado.</p>
                </div>
              )}
              {(() => {
                const focus = String(auditoria.producto || "").trim().toUpperCase()
                const esFoco = (nombre: any) => focus && String(nombre || "").trim().toUpperCase() === focus
                const peds: any[] = auditoria.data.pedidos ?? []
                const sals: any[] = auditoria.data.salidas ?? []
                const otras: any[] = auditoria.data.otras ?? []
                const totPedCarg = peds.reduce((s, r) => s + (Number(r.cargadas) || 0), 0)
                const totSal = sals.reduce((s, r) => s + (Math.abs(Number(r.cantidad)) || 0), 0)
                return (
                  <>
                    {/* PEDIDOS */}
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-sm font-semibold" style={{ color: SST_TOKENS.navy }}>
                        <ClipboardList className="h-4 w-4" /> Pedido detalle ({peds.length}) · cargadas: {fmt(totPedCarg)}
                      </div>
                      <div className="max-h-[28vh] overflow-auto rounded-md border">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted/60">
                            <tr className="text-left text-[10px] uppercase text-muted-foreground">
                              <th className="px-2 py-1.5">Emp</th><th className="px-2 py-1.5">idpedido</th><th className="px-2 py-1.5">transid</th>
                              <th className="px-2 py-1.5">Producto</th><th className="px-2 py-1.5 text-right">Pedidas</th><th className="px-2 py-1.5 text-right">Cargadas</th>
                              <th className="px-2 py-1.5">Estado línea</th><th className="px-2 py-1.5">Estado cab.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {peds.length === 0 ? (<tr><td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">Sin filas de pedido para este ocargue.</td></tr>) : peds.map((r, i) => (
                              <tr key={i} className={"border-t " + (esFoco(r.producto) ? "bg-amber-50" : "")}>
                                <td className="px-2 py-1">{r.id_empresa}</td><td className="px-2 py-1">{r.idpedido}</td><td className="px-2 py-1">{r.transid}</td>
                                <td className="px-2 py-1">{r.producto}</td>
                                <td className="px-2 py-1 text-right text-muted-foreground">
                                  {modoEdicion ? (
                                    <Input
                                      type="number"
                                      value={edits.pedU[r.transid] ?? String(r.unidades ?? 0)}
                                      onChange={(e) => setEdits((prev) => ({ ...prev, pedU: { ...prev.pedU, [r.transid]: e.target.value } }))}
                                      className="h-7 w-24 text-right text-xs"
                                    />
                                  ) : fmt(r.unidades)}
                                </td>
                                <td className="px-2 py-1 text-right font-medium">
                                  {modoEdicion ? (
                                    <Input
                                      type="number"
                                      value={edits.ped[r.transid] ?? String(r.cargadas ?? 0)}
                                      onChange={(e) => setEdits((prev) => ({ ...prev, ped: { ...prev.ped, [r.transid]: e.target.value } }))}
                                      className="h-7 w-24 text-right text-xs"
                                    />
                                  ) : fmt(r.cargadas)}
                                </td>
                                <td className="px-2 py-1">{r.estado || "—"}</td><td className="px-2 py-1">{r.estado_cabecera || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {/* SALIDAS */}
                    <div>
                      <div className="mb-1 flex items-center gap-2 text-sm font-semibold" style={{ color: SST_TOKENS.navy }}>
                        <ArrowDownToLine className="h-4 w-4" /> invtrans · Salidas ({sals.length}) · total: {fmt(totSal)}
                      </div>
                      <div className="max-h-[28vh] overflow-auto rounded-md border">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted/60">
                            <tr className="text-left text-[10px] uppercase text-muted-foreground">
                              <th className="px-2 py-1.5">Emp</th><th className="px-2 py-1.5">Fecha</th><th className="px-2 py-1.5">Producto</th>
                              <th className="px-2 py-1.5">Lote</th><th className="px-2 py-1.5 text-right">Cantidad</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Mov</th><th className="px-2 py-1.5">Ubic.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sals.length === 0 ? (<tr><td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">Sin salidas en invtrans para este ocargue.</td></tr>) : sals.map((r, i) => (
                              <tr key={i} className={"border-t " + (esFoco(r.nombreproducto) ? "bg-amber-50" : "")}>
                                <td className="px-2 py-1">{r.idempresa}</td><td className="px-2 py-1">{String(r.creado || "").slice(0, 10)}</td>
                                <td className="px-2 py-1">{r.nombreproducto}</td><td className="px-2 py-1 text-muted-foreground">{r.lote}</td>
                                <td className="px-2 py-1 text-right font-medium">{fmt(Math.abs(Number(r.cantidad) || 0))}</td>
                                <td className="px-2 py-1">{r.status}</td><td className="px-2 py-1">{r.cod_movimiento}</td><td className="px-2 py-1">{r.location}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {otras.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">Además hay <b>{otras.length}</b> movimiento(s) de invtrans en este ocargue que no son Salida (entradas/reprocesos/traslados/ajustes) — no cuentan como despacho.</p>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* FIRMA DIGITAL del acta de cierre mensual */}
      <Dialog open={!!actaSign} onOpenChange={(o) => { if (!o && !generandoActa) setActaSign(null) }}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Firmar y cerrar · {actaSign?.mes}</DialogTitle>
          </DialogHeader>
          {actaSign && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-sm">
                <div className="mb-1 font-medium" style={{ color: SST_TOKENS.navy }}>{selectedEmpresaNombre || "—"} · Periodo {actaSign.mes}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Saldo inicial</span><span className="text-right">{fmt(actaSign.saldoInicial)}</span>
                  <span className="text-muted-foreground">(+) Ingresos</span><span className="text-right">{fmt(actaSign.ingresos)}</span>
                  <span className="text-muted-foreground">(−) Órdenes de cargue</span><span className="text-right">{fmt(actaSign.cargue)}</span>
                  <span className="text-muted-foreground">(−) Merma</span><span className="text-right">{fmt(actaSign.merma)}</span>
                  <span className="font-semibold">(=) Saldo final conciliado</span><span className="text-right font-semibold">{fmt(actaSign.saldoFinal)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Firmante (nombre)</label>
                  <Input value={firmanteNom} onChange={(e) => setFirmanteNom(e.target.value)} placeholder="Nombre de quien firma" className="h-9" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Cargo (opcional)</label>
                  <Input value={firmanteCargo} onChange={(e) => setFirmanteCargo(e.target.value)} placeholder="Ej. Coordinador SST" className="h-9" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Firma digital</label>
                <SignaturePad ref={firmaActaRef} height={160} />
              </div>
              <p className="text-[11px] text-muted-foreground">El acta se genera en PDF con la firma embebida y se guarda en la carpeta de cierres. Queda como soporte de auditoría (ISO 9001 8.5.1).</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActaSign(null)} disabled={!!generandoActa}>Cancelar</Button>
            <Button onClick={() => generarYGuardarActa(actaSign)} disabled={!!generandoActa}>
              {generandoActa ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Firmar y generar acta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NOMENCLATURA de tipos de movimiento */}
      <Dialog open={verNomenclatura} onOpenChange={setVerNomenclatura}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base">Nomenclatura de tipos de movimiento (LIPgo)</DialogTitle></DialogHeader>
          {tiposMov.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Corre el SQL 17 para cargar el catálogo, o cárgalo desde la app.</p>
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

      {/* Ciclo completo de la orden, abierto desde una línea de la conciliación. */}
      <Orden360Dialog ordendecargue={orden360} open={orden360 !== null} onOpenChange={(v) => !v && setOrden360(null)} />

      {/* CUADRE MANUAL: exige la clave personal (proceso inv_cuadre_manual, SQL 224).
          Gerencia 2026-10-04: "esta acción sí debería estar con clave, la mía, solo esa acción". */}
      <Dialog open={!!pendienteCuadre} onOpenChange={(o) => { if (!o && !savingCuadre) { setPendienteCuadre(null); setClaveCuadre(""); setErrorClaveCuadre("") } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Autorizar cuadre manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-atencion-bd bg-atencion-bg p-3 text-xs text-atencion-fg">
              <p className="font-semibold">Vas a cambiar a mano {pendienteCuadre?.length ?? 0} línea(s) de pedido.</p>
              <p className="mt-1">No modifica el inventario físico, pero sí el lado del pedido: con esto una diferencia de la conciliación puede desaparecer. Queda registrado quién lo autorizó.</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="clave-cuadre">Tu clave personal</Label>
                <AyudaClaveAutorizacion />
              </div>
              <Input
                id="clave-cuadre"
                type="password"
                value={claveCuadre}
                onChange={(e) => { setClaveCuadre(e.target.value); setErrorClaveCuadre("") }}
                placeholder="Clave de autorización"
                disabled={savingCuadre}
                autoComplete="off"
                className={errorClaveCuadre ? "border-red-500" : ""}
              />
              {errorClaveCuadre && <p className="text-xs text-critico-fg">{errorClaveCuadre}</p>}
              <p className="text-xs text-muted-foreground">Solo autoriza la Gerencia General de LIPgo.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendienteCuadre(null); setClaveCuadre(""); setErrorClaveCuadre("") }} disabled={savingCuadre}>Cancelar</Button>
            <Button onClick={confirmarCuadreConClave} disabled={!claveCuadre.trim() || savingCuadre}>
              {savingCuadre ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Autorizar y guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
