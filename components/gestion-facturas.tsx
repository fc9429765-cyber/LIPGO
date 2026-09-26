"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/use-toast"
import { Loader2, FileText, Receipt, Search, ChevronLeft, ChevronRight, DollarSign, Upload, Camera, Image, X, CheckCircle, CreditCard, Filter, RotateCcw, Download, Lock, Trash2 } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useAuth } from "@/components/auth-provider"
import { getValoresNetosOrden } from "@/lib/facturacion-control-actions"
import { GESTION_LIPGO_DESDE } from "@/lib/facturacion-constantes"

interface GestionFacturasProps {
  onBack?: () => void
  /** Salto directo desde el aviso "N órdenes sin gestionar" de Ciclo de
   *  Facturación/Cuadro de Control -- deja la pantalla ya filtrada en el
   *  período/estado que hay que revisar, en vez de un aviso solo-lectura. */
  filtroInicial?: { estado?: string; fechaDesde?: string; fechaHasta?: string } | null
  onFiltroInicialConsumido?: () => void
}

interface OrdenCargue {
  id: number
  ordendecargue: string
  fechaorden: string
  placa: string
  transporte: string
  tipooperacion: string
  pesoorden: number
  tiquetebascula: string
  pesovascula: number
  fechacargue: string
  estadofactura: string | null
  mediopago: string | null
  valorpago: number | null
  iva: number | null
  comprobante: string | null
  cuentatransferencia: string | null
  retefuente: number | null
  idempresa: number
  facturasiigo: string | null
  cliente: string | null
  // Observaciones que el Coordinador deja al confirmar el pago (SIN FACTURA)
  // o al solicitar la factura (CON FACTURA). Se persiste en
  // `cabeceraoc.observacionesfactura`.
  observacionesfactura?: string | null
  // Solo viene del backend para empresas 1 y 2: MAX(peso_bascula) * MAX(tarifa)
  // calculado sobre la tabla `facturacion`. Usado para mostrar el valor a
  // facturar en el listado antes de que se confirme la factura.
  valor_a_facturar_calculado?: number | null
}

interface DetalleFacturacion {
  producto: string
  toneladas: number
  subcategoria: string
  tarifa: number
  valor_a_facturar: number
}

const MEDIOS_PAGO = [
  "Contado",
  "Crédito",
]

const CUENTAS_TRANSFERENCIA = [
  "Bancolombia",
  "AV Villas",
  "Efectivo",
]

export default function GestionFacturas({ onBack, filtroInicial, onFiltroInicialConsumido }: GestionFacturasProps) {
  const { selectedEmpresaId } = useAuth()
  const [loading, setLoading] = useState(true)
  const [ordenes, setOrdenes] = useState<OrdenCargue[]>([])
  // Valor NETO por orden (operación × tarifa por owner/id_empresa, igual que el cuadro).
  const [valoresNetos, setValoresNetos] = useState<Record<string, number>>({})
  const [searchTerm, setSearchTerm] = useState("")
  // Debounce: antes cada tecla disparaba una consulta al servidor.
  const [searchDebounced, setSearchDebounced] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(searchTerm), 350)
    return () => clearTimeout(t)
  }, [searchTerm])
  const [searchInput, setSearchInput] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const pageSize = 50

  // Filter states. fechaCargueDesde arranca en GESTION_LIPGO_DESDE: el backlog
  // anterior ya se facturó manual fuera de LIPgo (ver lib/facturacion-constantes.ts)
  // — "Limpiar filtros" (handleClearFilters) lo sigue dejando en blanco para
  // quien de verdad quiera ver todo el histórico a propósito.
  const [filters, setFilters] = useState({
    orden: "",
    fechaCargueDesde: GESTION_LIPGO_DESDE,
    fechaCargueHasta: "",
    placa: "",
    transporte: "",
    estado: "",
    tipoOperacion: "",
    medioPago: "",
    cuenta: "",
  })

  // Aplica el filtro que llega desde el salto de Ciclo de
  // Facturación/Cuadro de Control (ver evento "lipgo:ir-a-gestionar-facturas"
  // en main-content.tsx) y lo consume una sola vez -- para que una vuelta
  // normal a este módulo (sin salto) no lo vuelva a aplicar.
  useEffect(() => {
    if (!filtroInicial) return
    setFilters((f) => ({
      ...f,
      estado: filtroInicial.estado ?? f.estado,
      fechaCargueDesde: filtroInicial.fechaDesde ?? f.fechaCargueDesde,
      fechaCargueHasta: filtroInicial.fechaHasta ?? f.fechaCargueHasta,
    }))
    onFiltroInicialConsumido?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroInicial])

  // Transportes REALES que existen para el proyecto seleccionado (lista
  // desplegable, no texto libre) — evita amarrar una factura Siigo al
  // transporte equivocado por un typo.
  const [transportesDisponibles, setTransportesDisponibles] = useState<string[]>([])

  // Alias de lectura: el "Rango factura Siigo" usa el MISMO Desde/Hasta que el
  // filtro general de la hoja (una sola fuente de verdad para la fecha de
  // cargue). Para escribir, usar setFilters({ ...filters, fechaCargueDesde/Hasta }).
  const rangoDesde = filters.fechaCargueDesde
  const rangoHasta = filters.fechaCargueHasta

  // View state - 'list' for orders list, 'register' for registration form
  const [currentView, setCurrentView] = useState<"list" | "register">("list")
  // Flow type: "sin_factura" means Coordinator handles payment with subtotal calc,
  // "con_factura" means Coordinator only requests invoice, no subtotal shown
  const [currentFlow, setCurrentFlow] = useState<"sin_factura" | "con_factura">("sin_factura")
  const [selectedOrden, setSelectedOrden] = useState<OrdenCargue | null>(null)
  const [detallesFacturacion, setDetallesFacturacion] = useState<DetalleFacturacion[]>([])
  const [loadingDetalles, setLoadingDetalles] = useState(false)
  // Solo se llena para empresas 1 y 2: total calculado = MAX(peso_bascula) * MAX(tarifa)
  // devuelto por el endpoint /api/gestion-facturas/detalles como `totalCalculado`.
  // Si es `null` se cae al calculo normal (suma de valor_a_facturar por detalle).
  const [totalCalculadoDetalles, setTotalCalculadoDetalles] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    mediopago: "",
    comprobante: "",
    cuentatransferencia: "",
    retefuentePorcentaje: 0,
    aCredito: false,
    aplicarIva: true,
    cliente: "",
    // Observaciones visibles en ambos flujos (SIN FACTURA y CON FACTURA)
    // que se guardan en `cabeceraoc.observacionesfactura`.
    observaciones: "",
  })

  // Comprobante upload state - now supports multiple images
  const [comprobanteUrls, setComprobanteUrls] = useState<string[]>([])
  const [uploadingComprobante, setUploadingComprobante] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [viewingComprobanteIndex, setViewingComprobanteIndex] = useState(0)

  // Factura Siigo upload state
  const [facturaSiigoUrl, setFacturaSiigoUrl] = useState<string | null>(null)
  const [uploadingFacturaSiigo, setUploadingFacturaSiigo] = useState(false)
  const facturaSiigoInputRef = useRef<HTMLInputElement>(null)
  // Ref espejo de `selectedOrden`. En iOS, al activar la camara
  // nativa con `capture="environment"`, la WebView entra en background
  // y al volver el state puede quedar momentaneamente en null antes
  // de que React vuelva a hidratarlo. Con un ref siempre tenemos la
  // ultima orden activa para poder subir el archivo aunque el state
  // este momentaneamente nulo. Se sincroniza por effect mas abajo.
  const selectedOrdenRef = useRef<OrdenCargue | null>(null)
  const [uploadingSiigoOrden, setUploadingSiigoOrden] = useState<OrdenCargue | null>(null)

  // Comprobante viewer state
  const [viewingComprobante, setViewingComprobante] = useState<OrdenCargue | null>(null)

  // Confirmacion state
  const [confirmacionView, setConfirmacionView] = useState(false)
  const [ordenConfirmacion, setOrdenConfirmacion] = useState<OrdenCargue | null>(null)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [confirmacionFormData, setConfirmacionFormData] = useState({
    cliente: "",
    ivaPorcentaje: 19,
    retefuentePorcentaje: 0,
    cuentatransferencia: "",
  })
  const [detallesConfirmacion, setDetallesConfirmacion] = useState<DetalleFacturacion[]>([])
  const [loadingDetallesConfirmacion, setLoadingDetallesConfirmacion] = useState(false)
  // Amarrar la factura Siigo a un RANGO de fechas (varias solicitudes en una factura).
  // Usa el MISMO Desde/Hasta que el filtro general de la hoja (filters.fechaCargueDesde/
  // Hasta) — antes eran dos pares de fechas independientes, lo que permitía que la tabla
  // mostrara un rango y el amarre operara sobre otro sin que se notara.
  const [amarrandoRango, setAmarrandoRango] = useState(false)
  // Total calculado (MAX * MAX) para la vista de Confirmacion, empresas 1 y 2.
  const [totalCalculadoConfirmacion, setTotalCalculadoConfirmacion] = useState<number | null>(null)

  // Password protection for confirmation
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [passwordInput, setPasswordInput] = useState("")
  const [passwordError, setPasswordError] = useState(false)
  const [pendingOrdenConfirmacion, setPendingOrdenConfirmacion] = useState<OrdenCargue | null>(null)
  // Acción de Factura Siigo (montar/eliminar) pendiente de validar contraseña.
  const [pendingSiigo, setPendingSiigo] = useState<{ orden: OrdenCargue; accion: "montar" | "eliminar" } | null>(null)
  const CONFIRM_PASSWORD = "Jeff123456"

  // Export state
  const [exporting, setExporting] = useState(false)

  const loadOrdenes = async (page: number = 1, search: string = "", currentFilters = filters) => {
    if (!selectedEmpresaId) {
      setLoading(false)
      return
    }
    
    setLoading(true)
    try {
      const params = new URLSearchParams({
        empresaId: selectedEmpresaId.toString(),
        page: page.toString(),
        pageSize: pageSize.toString(),
      })
      if (search) {
        params.append("search", search)
      }
      // Add filters to params
      if (currentFilters.orden) params.append("orden", currentFilters.orden)
      if (currentFilters.fechaCargueDesde) params.append("fechaCargueDesde", currentFilters.fechaCargueDesde)
      if (currentFilters.fechaCargueHasta) params.append("fechaCargueHasta", currentFilters.fechaCargueHasta)
      if (currentFilters.placa) params.append("placa", currentFilters.placa)
      if (currentFilters.transporte) params.append("transporte", currentFilters.transporte)
      if (currentFilters.estado) params.append("estado", currentFilters.estado)
      if (currentFilters.tipoOperacion) params.append("tipoOperacion", currentFilters.tipoOperacion)
      if (currentFilters.medioPago) params.append("medioPago", currentFilters.medioPago)
      if (currentFilters.cuenta) params.append("cuenta", currentFilters.cuenta)

      const response = await fetch(`/api/gestion-facturas?${params}`)
      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudieron cargar las ordenes", variant: "destructive" })
        return
      }

      setOrdenes(result.data || [])
      setTotalPages(result.pagination?.totalPages || 1)
      setTotalCount(result.pagination?.totalCount || 0)
    } catch (error) {
      console.error("[v0] Error:", error)
      toast({ title: "Error", description: "Error al cargar datos", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setCurrentPage(1)
    loadOrdenes(1, searchDebounced, filters)
  }, [selectedEmpresaId, searchDebounced])

  // Carga la lista de transportes reales del proyecto (para el filtro
  // desplegable) cada vez que cambia la empresa o el rango de fechas del
  // "Rango factura Siigo" — si el rango está definido, solo ofrece los
  // transportes que de verdad tienen órdenes ahí (no los de otras fechas).
  useEffect(() => {
    if (!selectedEmpresaId) { setTransportesDisponibles([]); return }
    let cancel = false
    const params = new URLSearchParams({ empresaId: String(selectedEmpresaId) })
    if (rangoDesde) params.append("desde", rangoDesde)
    if (rangoHasta) params.append("hasta", rangoHasta)
    fetch(`/api/gestion-facturas/transportes?${params}`)
      .then((r) => r.json())
      .then((result) => {
        if (cancel || !result.success) return
        const lista: string[] = result.transportes || []
        setTransportesDisponibles(lista)
        // Si el transporte elegido ya no aplica al nuevo rango de fechas, se
        // limpia el filtro en vez de dejarlo "seleccionado" apuntando a algo
        // que ya no está en la lista.
        setFilters((prev) => (prev.transporte && prev.transporte !== "all" && !lista.includes(prev.transporte) ? { ...prev, transporte: "" } : prev))
      })
      .catch(() => { if (!cancel) setTransportesDisponibles([]) })
    return () => { cancel = true }
  }, [selectedEmpresaId, rangoDesde, rangoHasta])

  // Valor NETO solo de las órdenes de la página visible (ligero; se calcula igual que el cuadro).
  useEffect(() => {
    if (!selectedEmpresaId || ordenes.length === 0) { setValoresNetos({}); return }
    let cancel = false
    const nums = ordenes.map((o) => o.ordendecargue).filter(Boolean)
    getValoresNetosOrden(selectedEmpresaId, nums)
      .then((r) => { if (!cancel && r.success) setValoresNetos(r.data) })
      .catch(() => {})
    return () => { cancel = true }
  }, [selectedEmpresaId, ordenes])

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    loadOrdenes(newPage, searchTerm, filters)
  }

  const handleSearch = () => {
    setSearchTerm(searchInput)
    setCurrentPage(1)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  const handleApplyFilters = () => {
    setCurrentPage(1)
    loadOrdenes(1, searchTerm, filters)
  }

  const handleClearFilters = () => {
    const clearedFilters = {
      orden: "",
      fechaCargueDesde: "",
      fechaCargueHasta: "",
      placa: "",
      transporte: "",
      estado: "",
      tipoOperacion: "",
      medioPago: "",
      cuenta: "",
    }
    setFilters(clearedFilters)
    setCurrentPage(1)
    loadOrdenes(1, searchTerm, clearedFilters)
  }

  const handleExportToExcel = async () => {
    if (!selectedEmpresaId) return

    setExporting(true)
    try {
      const params = new URLSearchParams({
        empresaId: selectedEmpresaId.toString(),
      })
      if (searchTerm) params.append("search", searchTerm)
      if (filters.orden) params.append("orden", filters.orden)
      if (filters.fechaCargueDesde) params.append("fechaCargueDesde", filters.fechaCargueDesde)
      if (filters.fechaCargueHasta) params.append("fechaCargueHasta", filters.fechaCargueHasta)
      if (filters.placa) params.append("placa", filters.placa)
      if (filters.transporte) params.append("transporte", filters.transporte)
      if (filters.estado) params.append("estado", filters.estado)
      if (filters.tipoOperacion) params.append("tipoOperacion", filters.tipoOperacion)
      if (filters.medioPago) params.append("medioPago", filters.medioPago)
      if (filters.cuenta) params.append("cuenta", filters.cuenta)

      const response = await fetch(`/api/gestion-facturas/export?${params}`)
      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo exportar", variant: "destructive" })
        return
      }

      // Download the file
      const link = document.createElement("a")
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.data}`
      link.download = result.filename
      link.click()

      toast({ title: "Exito", description: "Archivo exportado correctamente" })
    } catch (error) {
      console.error("Error exporting:", error)
      toast({ title: "Error", description: "Error al exportar los datos", variant: "destructive" })
    } finally {
      setExporting(false)
    }
  }

  const loadDetallesFacturacion = async (ordenCargue: string) => {
    setLoadingDetalles(true)
    try {
      // Pasar empresaId para aplicar regla especial de calculo para empresas 1 y 2
      const params = new URLSearchParams({ numeroOrden: ordenCargue })
      if (selectedEmpresaId) {
        params.append("empresaId", selectedEmpresaId.toString())
      }
      const response = await fetch(`/api/gestion-facturas/detalles?${params}`)
      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudieron cargar los detalles de facturacion", variant: "destructive" })
        return
      }

      setDetallesFacturacion(result.data || [])
      // Solo empresas 1 y 2 traen `totalCalculado` desde el backend
      setTotalCalculadoDetalles(
        typeof result.totalCalculado === "number" ? result.totalCalculado : null,
      )
    } catch (error) {
      console.error("[v0] Error loading detalles:", error)
    } finally {
      setLoadingDetalles(false)
    }
  }

  const handleOpenRegistration = async (orden: OrdenCargue, flow: "sin_factura" | "con_factura" = "sin_factura") => {
    setSelectedOrden(orden)
    // Espejo sincrono: si la camara nativa se abre antes de que React
    // procese el setState, el upload todavia tiene la referencia.
    selectedOrdenRef.current = orden
    setCurrentFlow(flow)
    // En SIN FACTURA siempre es Contado (no hay opcion de credito).
    // En CON FACTURA el Coordinador define segun el cliente (Contado o Credito).
    let medioInicial: string
    if (flow === "sin_factura") {
      medioInicial = "Contado"
    } else {
      const esCredito = orden.estadofactura === "A credito" || orden.mediopago === "Crédito"
      medioInicial = orden.mediopago === "Contado" || orden.mediopago === "Crédito"
        ? orden.mediopago
        : (esCredito ? "Crédito" : "Contado")
    }
    setFormData({
      mediopago: medioInicial,
      comprobante: orden.comprobante || "",
      cuentatransferencia: medioInicial === "Crédito" ? "" : (orden.cuentatransferencia || ""),
      retefuentePorcentaje: 0,
      aCredito: medioInicial === "Crédito",
      aplicarIva: true,
      cliente: orden.cliente || "",
      observaciones: orden.observacionesfactura || "",
    })
    // Parse existing comprobante URLs - can be JSON array or single URL string
    let existingUrls: string[] = []
    if (orden.comprobante) {
      try {
        const parsed = JSON.parse(orden.comprobante)
        existingUrls = Array.isArray(parsed) ? parsed : [orden.comprobante]
      } catch {
        // If not valid JSON, treat as single URL
        existingUrls = [orden.comprobante]
      }
    }
    setComprobanteUrls(existingUrls)
    setCurrentView("register")
    await loadDetallesFacturacion(orden.ordendecargue)
  }

  const handleBackToList = () => {
    setCurrentView("list")
    setSelectedOrden(null)
    selectedOrdenRef.current = null
    setDetallesFacturacion([])
    setTotalCalculadoDetalles(null)
    setComprobanteUrls([])
  }

  /**
   * Comprime una imagen del cliente antes de enviarla al backend.
   *
   * Motivacion: las camaras de celulares modernos producen JPEGs de
   * 5–12 MB. La ruta `/api/gestion-facturas/upload-comprobante` corre
   * como funcion Serverless y Vercel impone un limite de ~4.5 MB en el
   * body del request, asi que esos archivos fallaban silenciosamente
   * con 413 / timeout sin un mensaje claro. Aqui:
   *   - Si NO es imagen (PDF, etc.), devolvemos el archivo intacto.
   *   - Si la imagen es <= 1.2 MB, la dejamos como esta (no perdemos
   *     calidad innecesariamente).
   *   - Si pesa mas, la redimensionamos a maximo 1600px en su lado
   *     mayor y la re-codificamos como JPEG calidad 0.85. Eso suele
   *     dejar la foto entre 250 KB y 700 KB, lejos del limite.
   * Si por cualquier razon el procesamiento falla (canvas tainted,
   * formato exotico, etc.), retornamos el archivo original — preferimos
   * intentar subirlo a perderlo.
   */
  const compressImageIfNeeded = async (file: File): Promise<File> => {
    if (!file.type.startsWith("image/")) return file
    // Umbral: archivos pequeños no se tocan.
    if (file.size <= 1.2 * 1024 * 1024) return file

    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })

      const img: HTMLImageElement = await new Promise((resolve, reject) => {
        const i = new window.Image()
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error("No se pudo decodificar la imagen"))
        i.src = dataUrl
      })

      const MAX_SIDE = 1600
      const ratio = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const targetW = Math.round(img.width * ratio)
      const targetH = Math.round(img.height * ratio)

      const canvas = document.createElement("canvas")
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext("2d")
      if (!ctx) return file
      ctx.drawImage(img, 0, 0, targetW, targetH)

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
      )
      if (!blob) return file

      // Si paradojicamente el blob comprimido es mas pesado, conserva
      // el original (puede pasar con imagenes muy pequeñas re-encoded).
      if (blob.size >= file.size) return file

      const baseName = file.name.replace(/\.[^.]+$/, "") || "foto"
      return new File([blob], `${baseName}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      })
    } catch (err) {
      console.error("[v0] compressImageIfNeeded fallback to original:", err)
      return file
    }
  }

  const handleUploadComprobante = async (file: File) => {
    // Caso reportado en moviles: al disparar la camara nativa de iOS la
    // WebView pierde el foco y, segun el momento del ciclo de vida del
    // dialog, `selectedOrden` puede quedar en null cuando vuelve el
    // control. Antes haciamos `return` silencioso y la foto "se tomaba
    // pero no cargaba". Ahora usamos el ref espejo como fallback antes
    // de declarar la operacion como invalida.
    const orden = selectedOrden ?? selectedOrdenRef.current
    if (!orden) {
      console.error("[v0] handleUploadComprobante sin selectedOrden ni ref")
      toast({
        title: "Error",
        description:
          "Se perdio la referencia a la orden. Vuelve a abrir el registro e intenta de nuevo.",
        variant: "destructive",
      })
      return
    }

    // Capturamos id en una variable local para que el resto del flow
    // no dependa de que `selectedOrden` siga existiendo cuando se
    // resuelven las promesas (compresion + fetch).
    const ordenId = orden.id

    setUploadingComprobante(true)
    try {
      console.log(
        "[v0] handleUploadComprobante start:",
        file.name,
        file.type,
        `${(file.size / 1024).toFixed(0)}KB`,
      )
      // Comprimimos antes de subir (clave para fotos de camara que
      // suelen pesar mas que el limite de body de Serverless).
      const fileToUpload = await compressImageIfNeeded(file)
      console.log(
        "[v0] handleUploadComprobante toUpload:",
        fileToUpload.name,
        fileToUpload.type,
        `${(fileToUpload.size / 1024).toFixed(0)}KB`,
      )

      const formDataUpload = new FormData()
      formDataUpload.append("file", fileToUpload)
      formDataUpload.append("ordenId", ordenId.toString())

      const response = await fetch("/api/gestion-facturas/upload-comprobante", {
        method: "POST",
        body: formDataUpload,
      })

      // Si el server respondio con un status != 2xx pero NO devolvio
      // JSON valido (caso tipico de 413 Payload Too Large generado por
      // la plataforma antes de llegar al handler), mostramos un mensaje
      // explicito en lugar de tirar un "JSON parse error" silencioso.
      let result: { success?: boolean; error?: string; url?: string } = {}
      try {
        result = await response.json()
      } catch {
        result = {
          success: false,
          error:
            response.status === 413
              ? "El archivo es muy pesado. Intenta tomar la foto en menor calidad o adjuntar una imagen mas liviana."
              : `Error ${response.status} al subir el archivo`,
        }
      }

      if (!response.ok || !result.success) {
        console.error("[v0] upload failed:", response.status, result)
        toast({
          title: "Error",
          description: result.error || "No se pudo subir el comprobante",
          variant: "destructive",
        })
        return
      }

      // Add new URL to array. Importante: usamos el callback de
      // setState para no depender de la closure de `comprobanteUrls`
      // (en iOS, cuando se suben varias fotos seguidas, la closure
      // capturaba el array vacio y el segundo upload sobreescribia al
      // primero — la foto "no aparecia").
      setComprobanteUrls((prev) => {
        const next = [...prev, result.url as string]
        setFormData((fd) => ({ ...fd, comprobante: JSON.stringify(next) }))
        return next
      })
      toast({ title: "Exito", description: "Comprobante subido correctamente" })
    } catch (error) {
      console.error("[v0] Error uploading comprobante:", error)
      toast({ title: "Error", description: "Error al subir el comprobante", variant: "destructive" })
    } finally {
      setUploadingComprobante(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // En iOS Safari el `FileList` que entrega `e.target.files` puede
    // invalidarse durante un `await` (sobre todo si el input se
    // resetea o re-renderiza). Clonamos a un array de `File` de
    // inmediato para tener referencias estables durante todo el flow.
    const files = e.target.files ? Array.from(e.target.files) : []
    console.log("[v0] handleFileChange files:", files.length)
    if (files.length === 0) {
      // En camara nativa de iOS, si el usuario cancela el shutter el
      // input puede disparar `change` con FileList vacio. No es un
      // error, simplemente salimos.
      return
    }

    // Reseteamos el input de inmediato (antes de comenzar la subida
    // asincrona) para permitir volver a tomar una foto identica.
    if (e.target) e.target.value = ""

    // Subir cada archivo secuencialmente para evitar saturar el
    // servidor de Blob. `handleUploadComprobante` agrega cada URL.
    for (const file of files) {
      if (file) {
        await handleUploadComprobante(file)
      }
    }
  }

  const handleRemoveComprobante = (indexToRemove: number) => {
    const newUrls = comprobanteUrls.filter((_, index) => index !== indexToRemove)
    setComprobanteUrls(newUrls)
    setFormData({ ...formData, comprobante: newUrls.length > 0 ? JSON.stringify(newUrls) : "" })
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""
  }

  const handleViewComprobante = (orden: OrdenCargue) => {
    setViewingComprobanteIndex(0)
    setViewingComprobante(orden)
  }

  // Factura Siigo upload functions
  const handleUploadFacturaSiigo = async (file: File, orden: OrdenCargue) => {
    setUploadingFacturaSiigo(true)
    try {
      const formDataUpload = new FormData()
      formDataUpload.append("file", file)
      formDataUpload.append("ordenId", orden.id.toString())
      formDataUpload.append("type", "facturasiigo")

      const response = await fetch("/api/gestion-facturas/upload-comprobante", {
        method: "POST",
        body: formDataUpload,
      })

      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo subir la factura Siigo", variant: "destructive" })
        return
      }

      toast({ title: "Exito", description: "Factura Siigo subida correctamente" })

      // Actualizar ordenConfirmacion localmente si estamos en la vista de Procesar Factura
      if (ordenConfirmacion && ordenConfirmacion.id === orden.id && result.url) {
        setOrdenConfirmacion({ ...ordenConfirmacion, facturasiigo: result.url })
      }

      if (rangoDesde && rangoHasta && result.url) {
        // AMARRE POR RANGO: la misma factura Siigo se amarra a TODAS las "CF - Factura
        // solicitada" de la empresa en el rango y las cierra (una factura cubre varios días).
        await amarrarRangoSiigo((orden as any).idempresa, result.url)
      } else if (result.url) {
        // SIN RANGO: al cargar la factura Siigo, esta orden queda CERRADA (CF - Cerrado).
        await fetch("/api/gestion-facturas", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orden.id, estadofactura: "CF - Cerrado" }),
        })
      }

      setUploadingSiigoOrden(null)
      loadOrdenes(currentPage, searchTerm)
    } catch (error) {
      console.error("Error uploading factura siigo:", error)
      toast({ title: "Error", description: "Error al subir la factura Siigo", variant: "destructive" })
    } finally {
      setUploadingFacturaSiigo(false)
    }
  }

  const handleFacturaSiigoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && uploadingSiigoOrden) {
      handleUploadFacturaSiigo(file, uploadingSiigoOrden)
    }
    if (facturaSiigoInputRef.current) facturaSiigoInputRef.current.value = ""
  }

  const handleOpenFacturaSiigoUpload = (orden: OrdenCargue) => {
    setUploadingSiigoOrden(orden)
    setTimeout(() => facturaSiigoInputRef.current?.click(), 100)
  }

  // Pide la CONTRASEÑA antes de montar o eliminar una factura Siigo. Ambas
  // acciones (cargar/eliminar) quedan protegidas: solo quien tenga la clave
  // puede montar o quitar facturas.
  const handleRequestSiigo = (orden: OrdenCargue, accion: "montar" | "eliminar") => {
    setPendingSiigo({ orden, accion })
    setPasswordInput("")
    setPasswordError(false)
    setShowPasswordDialog(true)
  }

  // Elimina la factura Siigo de la orden: limpia el archivo y devuelve la orden
  // a "CF - Factura solicitada" para poder montar otra. Protegida por contraseña.
  const handleDeleteFacturaSiigo = async (orden: OrdenCargue) => {
    try {
      const res = await fetch("/api/gestion-facturas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orden.id,
          estadofactura: "CF - Factura solicitada",
          facturasiigo: null,
        }),
      })
      const result = await res.json()
      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo eliminar la factura Siigo", variant: "destructive" })
        return
      }
      toast({ title: "Factura Siigo eliminada", description: "La orden volvió a 'Factura solicitada'." })
      loadOrdenes(currentPage, searchTerm)
    } catch (error) {
      console.error("Error eliminando factura siigo:", error)
      toast({ title: "Error", description: "Error al eliminar la factura Siigo", variant: "destructive" })
    }
  }

  // Show password dialog before opening confirmation
  const handleRequestConfirmacion = (orden: OrdenCargue) => {
    setPendingOrdenConfirmacion(orden)
    setPasswordInput("")
    setPasswordError(false)
    setShowPasswordDialog(true)
  }

  const handlePasswordSubmit = async () => {
    if (passwordInput !== CONFIRM_PASSWORD) {
      setPasswordError(true)
      return
    }
    
    setShowPasswordDialog(false)
    setPasswordInput("")
    setPasswordError(false)

    // Acción de Factura Siigo (montar / eliminar) protegida por contraseña.
    if (pendingSiigo) {
      const { orden, accion } = pendingSiigo
      setPendingSiigo(null)
      if (accion === "montar") {
        handleOpenFacturaSiigoUpload(orden)
      } else {
        await handleDeleteFacturaSiigo(orden)
      }
      return
    }

    if (pendingOrdenConfirmacion) {
      await handleOpenConfirmacion(pendingOrdenConfirmacion)
      setPendingOrdenConfirmacion(null)
    }
  }

  const handleOpenConfirmacion = async (orden: OrdenCargue) => {
    setOrdenConfirmacion(orden)
    // Calculate base value (valorpago without IVA) for percentage calculations
    // If IVA exists, try to derive the percentage, otherwise default to 19%
    const baseValue = orden.valorpago || 0
    const existingIva = orden.iva || 0
    const existingRetefuente = orden.retefuente || 0
    
    // Try to calculate existing percentages if values exist
    let ivaPorcentaje = 19 // default
    let retefuentePorcentaje = 0
    
    if (baseValue > 0 && existingIva > 0) {
      // Approximate percentage from existing values
      ivaPorcentaje = Math.round((existingIva / (baseValue - existingIva + existingRetefuente)) * 100)
    }
    if (baseValue > 0 && existingRetefuente > 0) {
      retefuentePorcentaje = Math.round((existingRetefuente / (baseValue - existingIva + existingRetefuente)) * 100)
    }
    
    setConfirmacionFormData({
      cliente: orden.cliente || "",
      ivaPorcentaje: ivaPorcentaje || 19,
      retefuentePorcentaje: retefuentePorcentaje || 0,
      cuentatransferencia: orden.cuentatransferencia || "",
    })
    setConfirmacionView(true)
    
    // Load details for confirmation view
    setLoadingDetallesConfirmacion(true)
    try {
      // Pasar empresaId para aplicar regla especial de calculo para empresas 1 y 2
      const params = new URLSearchParams({ numeroOrden: orden.ordendecargue })
      if (selectedEmpresaId) {
        params.append("empresaId", selectedEmpresaId.toString())
      }
      const response = await fetch(`/api/gestion-facturas/detalles?${params}`)
      const result = await response.json()
      if (result.success) {
        setDetallesConfirmacion(result.data || [])
        setTotalCalculadoConfirmacion(
          typeof result.totalCalculado === "number" ? result.totalCalculado : null,
        )
      } else {
        setDetallesConfirmacion([])
        setTotalCalculadoConfirmacion(null)
      }
    } catch (error) {
      console.error("Error loading detalles for confirmation:", error)
      setDetallesConfirmacion([])
      setTotalCalculadoConfirmacion(null)
    } finally {
      setLoadingDetallesConfirmacion(false)
    }
  }

  const handleBackFromConfirmacion = () => {
    setConfirmacionView(false)
    setOrdenConfirmacion(null)
  }

  const handleConfirmPayment = async () => {
    if (!ordenConfirmacion) return

    // Validacion: Cliente es obligatorio al cerrar facturacion (CON FACTURA y legacy)
    if (!confirmacionFormData.cliente || confirmacionFormData.cliente.trim() === "") {
      toast({
        title: "Cliente requerido",
        description: "Debes ingresar el nombre del cliente antes de cerrar la factura.",
        variant: "destructive",
      })
      return
    }

    // Calculate actual values from percentages
    // Base = valorpago / (1 + ivaPorcentaje/100) approximately
    const valorTotal = ordenConfirmacion.valorpago || 0
    const baseValue = valorTotal / (1 + confirmacionFormData.ivaPorcentaje / 100)
    const ivaCalculadoConfirm = baseValue * (confirmacionFormData.ivaPorcentaje / 100)
    const retefuenteCalculadoConfirm = baseValue * (confirmacionFormData.retefuentePorcentaje / 100)

    setConfirmingPayment(true)
    try {
      // Determinar estado destino segun flujo actual:
      // - CON FACTURA (CF - Factura solicitada) → "CF - Cerrado" (Paso 2 Facturacion LiP asigna valores y cierra)
      // - Cualquier otro caso (legacy) → "Confirmado - recibido"
      const isConFacturaFlow = ordenConfirmacion.estadofactura === "CF - Factura solicitada"
        || ordenConfirmacion.estadofactura === "Facturado - por validar"
        || ordenConfirmacion.estadofactura === "A credito"
      const estadoDestino = ordenConfirmacion.estadofactura === "CF - Factura solicitada"
        ? "CF - Cerrado"
        : "Confirmado - recibido"

      // Calcular subtotal base:
      // - Empresas 1 y 2: usar el total calculado por el backend (MAX(peso_bascula) * MAX(tarifa))
      // - Resto: si hay detalles, sumar valor_a_facturar; si no, derivar desde valorpago asumiendo IVA incluido
      const subtotalFromDetalles = detallesConfirmacion.reduce((sum, d) => sum + (parseFloat(String(d.valor_a_facturar)) || 0), 0)
      const subtotalBase = totalCalculadoConfirmacion !== null
        ? totalCalculadoConfirmacion
        : subtotalFromDetalles > 0
          ? subtotalFromDetalles
          : (ordenConfirmacion.valorpago || 0) / (1 + confirmacionFormData.ivaPorcentaje / 100)
      const ivaFromSubtotal = subtotalBase * (confirmacionFormData.ivaPorcentaje / 100)
      const retefuenteFromSubtotal = subtotalBase * (confirmacionFormData.retefuentePorcentaje / 100)
      // Valor total de la factura = Subtotal + IVA - Retefuente (coincide con el Valor Total mostrado en la UI)
      const valorTotalCalculado = subtotalBase + ivaFromSubtotal - retefuenteFromSubtotal

      const body: Record<string, unknown> = {
        orderId: ordenConfirmacion.id,
        estadofactura: estadoDestino,
        cliente: confirmacionFormData.cliente,
      }

      // Permitir actualizar la cuenta de transferencia al cerrar (puede elegirse en Procesar Factura
      // incluso cuando el medio de pago es Credito, que es el caso tipico CON FACTURA).
      if (confirmacionFormData.cuentatransferencia) {
        body.cuentatransferencia = confirmacionFormData.cuentatransferencia
      }

      if (isConFacturaFlow) {
        // Para CON FACTURA SIEMPRE guardar los valores calculados (subtotal + IVA - retefuente)
        // para que el valor total de la factura se refleje en el listado.
        body.iva = Math.round(ivaFromSubtotal * 100) / 100
        body.retefuente = Math.round(retefuenteFromSubtotal * 100) / 100
        body.valorpago = Math.round(valorTotalCalculado * 100) / 100
      } else {
        // Para legacy, usar calculos basados en valorpago existente
        body.iva = Math.round(ivaCalculadoConfirm * 100) / 100
        body.retefuente = Math.round(retefuenteCalculadoConfirm * 100) / 100
      }

      const response = await fetch("/api/gestion-facturas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo confirmar el pago", variant: "destructive" })
        return
      }

      toast({ title: "Exito", description: "Pago confirmado correctamente" })
      handleBackFromConfirmacion()
      loadOrdenes(currentPage, searchTerm)
    } catch (error) {
      console.error("Error confirming payment:", error)
      toast({ title: "Error", description: "Error al confirmar el pago", variant: "destructive" })
    } finally {
      setConfirmingPayment(false)
    }
  }

  // Amarra una factura Siigo (URL) a TODAS las órdenes "CF - Factura solicitada" de una
  // empresa dentro del rango de FECHA DE CARGUE seleccionado. Se llama al cargar la factura.
  const amarrarRangoSiigo = async (idempresa: number, facturasiigo: string) => {
    if (!rangoDesde || !rangoHasta) return
    setAmarrandoRango(true)
    try {
      const res = await fetch("/api/gestion-facturas/amarrar-rango", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempresa,
          facturasiigo,
          desde: rangoDesde,
          hasta: rangoHasta,
          transporte: transporteFiltroActivo || undefined,
        }),
      })
      const result = await res.json()
      if (!result.success) {
        toast({ title: "Error al amarrar rango", description: result.error, variant: "destructive" })
        return
      }
      toast({
        title: "Factura amarrada al rango",
        description: `${result.count} orden(es) 'Factura solicitada' del rango${transporteFiltroActivo ? ` (transporte "${transporteFiltroActivo}")` : ""} quedaron amarradas a la factura Siigo y cerradas.`,
      })
    } catch (error) {
      console.error("Error amarrando rango:", error)
      toast({ title: "Error", description: "Error al amarrar el rango", variant: "destructive" })
    } finally {
      setAmarrandoRango(false)
    }
  }

  // DESHACER el amarre del rango: revierte las cerradas con factura Siigo del rango a
  // "Factura solicitada" y les quita la factura (útil para pruebas).
  const deshacerAmarreRango = async () => {
    if (!rangoDesde || !rangoHasta) {
      toast({ title: "Rango requerido", description: "Define el rango a deshacer.", variant: "destructive" })
      return
    }
    if (!selectedEmpresaId) {
      toast({ title: "Selecciona un proyecto", variant: "destructive" })
      return
    }
    if (!confirm(`¿Deshacer el amarre${transporteFiltroActivo ? ` del transporte "${transporteFiltroActivo}"` : ""}? Las órdenes cerradas con factura Siigo de este rango volverán a 'Factura solicitada' y se les quitará la factura.`)) return
    setAmarrandoRango(true)
    try {
      const res = await fetch("/api/gestion-facturas/amarrar-rango", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempresa: selectedEmpresaId,
          desde: rangoDesde,
          hasta: rangoHasta,
          transporte: transporteFiltroActivo || undefined,
          undo: true,
        }),
      })
      const result = await res.json()
      if (!result.success) {
        toast({ title: "Error", description: result.error, variant: "destructive" })
        return
      }
      toast({ title: "Amarre deshecho", description: `${result.count} orden(es) volvieron a 'Factura solicitada'.` })
      loadOrdenes(currentPage, searchTerm)
    } catch (error) {
      console.error("Error deshaciendo amarre:", error)
      toast({ title: "Error", description: "Error al deshacer el amarre", variant: "destructive" })
    } finally {
      setAmarrandoRango(false)
    }
  }

  // Transporte activo del filtro (el Select usa "all" para "Todos", que
  // equivale a "sin filtro" — igual que Estado/Tipo Operación en este mismo
  // formulario).
  const transporteFiltroActivo = filters.transporte && filters.transporte !== "all" ? filters.transporte : ""

  // ¿Una orden cae en el rango de facturación seleccionado (fecha de cargue) y está pendiente?
  // Si hay un Transporte activo en los filtros, también debe coincidir (mismo criterio
  // "contiene, sin mayúsculas" que usa ese filtro) — así la vista previa coincide
  // exactamente con lo que el amarre en el backend va a afectar.
  const enRangoSiigo = (orden: OrdenCargue): boolean => {
    if (!rangoDesde || !rangoHasta) return false
    if (orden.estadofactura !== "CF - Factura solicitada") return false
    const f = (orden as any).fechacargue
    if (!f) return false
    const fc = String(f).slice(0, 10)
    if (fc < rangoDesde || fc > rangoHasta) return false
    if (transporteFiltroActivo && !(orden.transporte ?? "").toLowerCase().includes(transporteFiltroActivo.toLowerCase())) return false
    return true
  }

  // Calculate totals - ensure values are parsed as numbers.
  // Para empresas 1 y 2 el subtotal viene del backend como MAX(peso_bascula) * MAX(tarifa);
  // en ese caso NO se suma valor_a_facturar de cada detalle. Para el resto de empresas
  // se mantiene el calculo original sumando los detalles.
  const subtotal = totalCalculadoDetalles !== null
    ? totalCalculadoDetalles
    : detallesFacturacion.reduce((sum, d) => sum + (parseFloat(String(d.valor_a_facturar)) || 0), 0)
  // En SIN FACTURA el IVA no se calcula (queda en 0). En CON FACTURA aplica el 19% segun aplicarIva.
  const ivaCalculado = currentFlow === "sin_factura"
    ? 0
    : (formData.aplicarIva ? subtotal * 0.19 : 0)
  const retefuenteCalculado = subtotal * (formData.retefuentePorcentaje / 100)
  const totalFactura = subtotal + ivaCalculado - retefuenteCalculado

  const handleSaveFacturacion = async () => {
    if (!selectedOrden) return

    if (!formData.mediopago) {
      toast({ title: "Error", description: "Seleccione un medio de pago", variant: "destructive" })
      return
    }

    // Validar que si es Contado, tenga cuenta de transferencia
    if (formData.mediopago === "Contado" && !formData.cuentatransferencia) {
      toast({ title: "Error", description: "Seleccione una cuenta de transferencia", variant: "destructive" })
      return
    }

    // Para SIN FACTURA se requiere comprobante
    if (currentFlow === "sin_factura" && comprobanteUrls.length === 0) {
      toast({ title: "Error", description: "Adjunte al menos un comprobante de pago", variant: "destructive" })
      return
    }

    setSaving(true)
    try {
      // Estados distintos por flujo:
      // - SIN FACTURA → "SF - Pago confirmado" (queda pendiente que Facturacion LiP cierre)
      // - CON FACTURA → "CF - Factura solicitada" (queda pendiente que Facturacion LiP procese)
      const nuevoEstado = currentFlow === "sin_factura"
        ? "SF - Pago confirmado"
        : "CF - Factura solicitada"

      const body: Record<string, unknown> = {
        orderId: selectedOrden.id,
        mediopago: formData.mediopago,
        comprobante: formData.comprobante,
        cuentatransferencia: formData.cuentatransferencia,
        estadofactura: nuevoEstado,
        cliente: formData.cliente || undefined,
        // Permitir guardar vacio tambien (para limpiar observaciones previas)
        observacionesfactura: formData.observaciones,
      }

      // Solo en SIN FACTURA se calculan valores aqui (Paso 1 del Coordinador LiP)
      // Total = Subtotal + IVA + Retefuente (segun regla del flujo SIN FACTURA)
      if (currentFlow === "sin_factura") {
        body.valorpago = subtotal + ivaCalculado + retefuenteCalculado
        body.iva = ivaCalculado
        body.retefuente = retefuenteCalculado
      }

      const response = await fetch("/api/gestion-facturas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo registrar la facturacion", variant: "destructive" })
        return
      }

      toast({
        title: "Exito",
        description: currentFlow === "sin_factura"
          ? "Pago confirmado correctamente"
          : "Factura solicitada correctamente",
      })
      handleBackToList()
      loadOrdenes()
    } catch (error) {
      console.error("Error:", error)
      toast({ title: "Error", description: "Error al guardar", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // Handler for Paso 2: Facturacion LiP - Cerrar Facturacion (SIN FACTURA flow)
  const [closingFacturacion, setClosingFacturacion] = useState(false)
  const [pendingCerrarOrden, setPendingCerrarOrden] = useState<OrdenCargue | null>(null)
  const [showCerrarPasswordDialog, setShowCerrarPasswordDialog] = useState(false)

  const handleRequestCerrarFacturacion = (orden: OrdenCargue) => {
    setPendingCerrarOrden(orden)
    setPasswordInput("")
    setPasswordError(false)
    setShowCerrarPasswordDialog(true)
  }

  const handleCerrarPasswordSubmit = async () => {
    if (passwordInput !== CONFIRM_PASSWORD) {
      setPasswordError(true)
      return
    }
    setShowCerrarPasswordDialog(false)
    setPasswordInput("")
    setPasswordError(false)

    if (pendingCerrarOrden) {
      await handleCerrarFacturacion(pendingCerrarOrden)
      setPendingCerrarOrden(null)
    }
  }

  const handleCerrarFacturacion = async (orden: OrdenCargue) => {
    setClosingFacturacion(true)
    try {
      const response = await fetch("/api/gestion-facturas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orden.id,
          estadofactura: "SF - Cerrado",
        }),
      })

      const result = await response.json()

      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo cerrar la facturacion", variant: "destructive" })
        return
      }

      toast({ title: "Exito", description: "Facturacion cerrada correctamente" })
      loadOrdenes(currentPage, searchTerm)
    } catch (error) {
      console.error("Error closing facturacion:", error)
      toast({ title: "Error", description: "Error al cerrar la facturacion", variant: "destructive" })
    } finally {
      setClosingFacturacion(false)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-"
    try {
      return new Date(dateStr + "T12:00:00").toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    } catch {
      return dateStr
    }
  }

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return "-"
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 0,
    }).format(value)
  }

  // La tarifa (a diferencia del Total) puede ser fraccionaria de verdad -- ej.
  // Huevo $2,95/unidad -- formatCurrency() la redondeaba a $3 (COP por
  // defecto no usa decimales sin maximumFractionDigits explícito).
  const formatCurrencyTarifa = (value: number | null) => {
    if (value === null || value === undefined) return "-"
    if (Number.isInteger(value)) return formatCurrency(value)
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  // Helper para detectar si un comprobante adjunto es PDF.
  // Soporta URLs de Vercel Blob con querystring (?...) u otros sufijos.
  // Declarado aqui (antes de las vistas JSX) porque `registrationView`,
  // `confirmacionViewComponent` y el viewer lo consumen durante su creacion.
  const isPdfUrl = (url: string): boolean => {
    if (!url) return false
    try {
      const clean = url.split("?")[0].split("#")[0]
      return clean.toLowerCase().endsWith(".pdf")
    } catch {
      return /\.pdf(\b|$)/i.test(url)
    }
  }

  const getEstadoBadge = (estado: string | null) => {
    if (!estado || estado === "") {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Pendiente por procesar</Badge>
    }
    // Nuevos estados del flujo SIN FACTURA
    if (estado === "SF - Pago confirmado") {
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">SF - Pago confirmado</Badge>
    }
    if (estado === "SF - Cerrado") {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">SF - Cerrado</Badge>
    }
    // Nuevos estados del flujo CON FACTURA
    if (estado === "CF - Factura solicitada") {
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">CF - Factura solicitada</Badge>
    }
    if (estado === "CF - Cerrado") {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">CF - Cerrado</Badge>
    }
    // Estados legacy
    if (estado === "Facturado - por validar") {
      return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{estado}</Badge>
    }
    if (estado === "A credito") {
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{estado}</Badge>
    }
    if (estado.toLowerCase().includes("validado") || estado.toLowerCase().includes("aprobado") || estado.toLowerCase().includes("confirmado")) {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{estado}</Badge>
    }
    return <Badge variant="outline">{estado}</Badge>
  }

  // Hidden input for Factura Siigo upload
  const facturaSiigoInput = (
    <input
      type="file"
      ref={facturaSiigoInputRef}
      onChange={handleFacturaSiigoFileChange}
      accept=".pdf,.jpg,.jpeg,.png"
      className="hidden"
    />
  )

// Pagination info
  const startIndex = (currentPage - 1) * pageSize

  // List View
  const listView = (
    <div className="space-y-4">
      {facturaSiigoInput}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              Gestion de Facturas
            </CardTitle>
            {onBack && (
              <Button variant="outline" size="sm" onClick={onBack}>
                Volver
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="space-y-4 mb-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Filter className="h-4 w-4" />
              Filtros
              <span className="font-normal text-xs">
                — vista inicial desde {GESTION_LIPGO_DESDE} (lo anterior ya se facturó manual); quita la fecha para
                ver el histórico completo.
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Orden</Label>
                <Input
                  placeholder="No. Orden"
                  value={filters.orden}
                  onChange={(e) => setFilters({ ...filters, orden: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha Cargue Desde</Label>
                <DatePickerField
                  value={filters.fechaCargueDesde}
                  onChange={(value) => setFilters({ ...filters, fechaCargueDesde: value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Fecha Cargue Hasta</Label>
                <DatePickerField
                  value={filters.fechaCargueHasta}
                  onChange={(value) => setFilters({ ...filters, fechaCargueHasta: value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Placa</Label>
                <Input
                  placeholder="Placa"
                  value={filters.placa}
                  onChange={(e) => setFilters({ ...filters, placa: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Transporte</Label>
                <Select
                  value={filters.transporte || "all"}
                  onValueChange={(value) => setFilters({ ...filters, transporte: value })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {transportesDisponibles.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Estado</Label>
                <Select
                  value={filters.estado}
                  onValueChange={(value) => setFilters({ ...filters, estado: value })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="pendiente">Pendiente por procesar</SelectItem>
                    <SelectItem value="sf_pago_confirmado">SF - Pago confirmado</SelectItem>
                    <SelectItem value="sf_cerrado">SF - Cerrado</SelectItem>
                    <SelectItem value="cf_solicitada">CF - Factura solicitada</SelectItem>
                    <SelectItem value="cf_cerrado">CF - Cerrado</SelectItem>
                    <SelectItem value="facturado">Facturado - por validar</SelectItem>
                    <SelectItem value="credito">A credito</SelectItem>
                    <SelectItem value="validado">Validado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo Operacion</Label>
                <Select
                  value={filters.tipoOperacion}
                  onValueChange={(value) => setFilters({ ...filters, tipoOperacion: value })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="Cargue">Cargue</SelectItem>
                    <SelectItem value="Descargue">Descargue</SelectItem>
                    <SelectItem value="Distribucion">Distribucion</SelectItem>
                    <SelectItem value="Tolva">Tolva</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Medio de Pago</Label>
                <Select
                  value={filters.medioPago}
                  onValueChange={(value) => setFilters({ ...filters, medioPago: value })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {MEDIOS_PAGO.map((medio) => (
                      <SelectItem key={medio} value={medio}>{medio}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cuenta</Label>
                <Select
                  value={filters.cuenta}
                  onValueChange={(value) => setFilters({ ...filters, cuenta: value })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {CUENTAS_TRANSFERENCIA.map((cuenta) => (
                      <SelectItem key={cuenta} value={cuenta}>{cuenta}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleApplyFilters} size="sm" className="h-8">
                <Filter className="h-3 w-3 mr-1" />
                Aplicar Filtros
              </Button>
              <Button onClick={handleClearFilters} variant="outline" size="sm" className="h-8">
                <RotateCcw className="h-3 w-3 mr-1" />
                Limpiar
              </Button>
              <div className="flex-1" />
              <Button onClick={handleExportToExcel} disabled={exporting || totalCount === 0} variant="outline" size="sm" className="h-8">
                {exporting ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Download className="h-3 w-3 mr-1" />
                )}
                {exporting ? "Exportando..." : "Exportar Excel"}
              </Button>
              <Badge variant="secondary">{totalCount.toLocaleString()} ordenes</Badge>
            </div>
          </div>

          {/* RANGO FACTURA SIIGO: una factura de Siigo cubre varios días/solicitudes.
              Al definir el rango (por FECHA DE CARGUE), las órdenes "Factura solicitada"
              de ese rango se marcan "En rango"; al cargar la factura Siigo en cualquiera
              de ellas, se amarra automáticamente a TODAS las de ese rango. */}
          <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:bg-blue-950/20">
            <div>
              <div className="text-xs font-semibold text-blue-900 dark:text-blue-300">Rango factura Siigo (fecha de cargue)</div>
              <p className="text-[11px] text-muted-foreground">
                Marca las "Factura solicitada" del rango. Al cargar la factura Siigo, se amarra a todas ellas.
                {transporteFiltroActivo
                  ? ` Con el filtro de Transporte activo, SOLO se amarran las de "${transporteFiltroActivo}".`
                  : " Usa el filtro de Transporte (arriba) si el rango tiene más de una transportadora, para amarrar solo la que corresponde."}
              </p>
            </div>
            <div>
              <Label className="text-[11px]">Desde</Label>
              <DatePickerField
                value={rangoDesde}
                onChange={(value) => setFilters({ ...filters, fechaCargueDesde: value })}
                className="h-8 w-40 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px]">Hasta</Label>
              <DatePickerField
                value={rangoHasta}
                onChange={(value) => setFilters({ ...filters, fechaCargueHasta: value })}
                className="h-8 w-40 text-xs"
              />
            </div>
            {(rangoDesde || rangoHasta) && (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setFilters({ ...filters, fechaCargueDesde: "", fechaCargueHasta: "" })}
              >
                Limpiar rango
              </Button>
            )}
            {rangoDesde && rangoHasta && (
              <Button variant="outline" size="sm" className="h-8 border-red-300 text-red-700 hover:bg-red-50" onClick={deshacerAmarreRango} disabled={amarrandoRango}>
                <RotateCcw className="mr-1 h-3 w-3" /> Deshacer amarre
              </Button>
            )}
            {rangoDesde && rangoHasta && (
              <Badge className="bg-blue-600">
                {ordenes.filter((o) => enRangoSiigo(o)).length} en rango (pág. actual)
                {transporteFiltroActivo ? ` · transporte "${transporteFiltroActivo}"` : ""}
              </Badge>
            )}
            {amarrandoRango && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : ordenes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No se encontraron ordenes.
            </div>
          ) : (
            <>
              <ScrollArea className="w-full rounded-md border">
                <div className="min-w-[1200px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs font-semibold">Orden</TableHead>
                        <TableHead className="text-xs font-semibold">Fecha Orden</TableHead>
                        <TableHead className="text-xs font-semibold">Placa</TableHead>
                        <TableHead className="text-xs font-semibold">Transporte</TableHead>
                        <TableHead className="text-xs font-semibold">Tipo Op.</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Peso Orden</TableHead>
                        <TableHead className="text-xs font-semibold">Tiquete Bascula</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Peso Bascula</TableHead>
                        <TableHead className="text-xs font-semibold">Fecha Cargue</TableHead>
                        <TableHead className="text-xs font-semibold">Estado</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Rango Siigo</TableHead>
                        <TableHead className="text-xs font-semibold">Medio Pago</TableHead>
                        <TableHead className="text-xs font-semibold">Cuenta</TableHead>
                        {/* Valor NETO de la orden (operación × tarifa por owner/id_empresa,
                            igual que el cuadro de control). Base antes de IVA/retefuente. */}
                        <TableHead className="text-xs font-semibold text-right">Valor Neto Orden</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Valor Pago</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Comprobante</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ordenes.map((orden) => (
                        <TableRow key={orden.id} className="hover:bg-muted/30">
                          <TableCell className="text-xs font-medium">{orden.ordendecargue}</TableCell>
                          <TableCell className="text-xs">{formatDate(orden.fechaorden)}</TableCell>
                          <TableCell className="text-xs">{orden.placa || "-"}</TableCell>
                          <TableCell className="text-xs">{orden.transporte || "-"}</TableCell>
                          <TableCell className="text-xs">{orden.tipooperacion || "-"}</TableCell>
                          <TableCell className="text-xs text-right">{orden.pesoorden?.toLocaleString() || "-"}</TableCell>
                          <TableCell className="text-xs">{orden.tiquetebascula || "-"}</TableCell>
                          <TableCell className="text-xs text-right">{orden.pesovascula?.toLocaleString() || "-"}</TableCell>
                          <TableCell className="text-xs">{formatDate(orden.fechacargue)}</TableCell>
                          <TableCell className="text-xs">{getEstadoBadge(orden.estadofactura)}</TableCell>
                          <TableCell className="text-center text-xs">
                            {orden.facturasiigo ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40">
                                ✓ Facturada
                              </span>
                            ) : enRangoSiigo(orden) ? (
                              <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40">
                                ● En rango
                              </span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{orden.mediopago || "-"}</TableCell>
                          <TableCell className="text-xs">{orden.cuentatransferencia || "-"}</TableCell>
                          <TableCell className="text-xs text-right font-semibold text-primary">
                            {valoresNetos[orden.ordendecargue] != null
                              ? formatCurrency(valoresNetos[orden.ordendecargue])
                              : "-"}
                          </TableCell>
                          <TableCell className="text-xs text-right">{formatCurrency(orden.valorpago)}</TableCell>
                          <TableCell className="text-center">
                            {orden.comprobante ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleViewComprobante(orden)}
                                className="text-xs h-7 px-2"
                              >
                                <Image className="h-3 w-3 mr-1" />
                                Ver
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1 flex-wrap">
                              {/* Paso 1 - Coordinador LiP: Pendiente por procesar → mostrar los dos flujos */}
                              {(!orden.estadofactura || orden.estadofactura === "") && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenRegistration(orden, "sin_factura")}
                                    className="text-xs h-7 px-2 border-green-300 text-green-700 hover:bg-green-50"
                                  >
                                    <DollarSign className="h-3 w-3 mr-1" />
                                    SIN FACTURA
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleOpenRegistration(orden, "con_factura")}
                                    className="text-xs h-7 px-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                                  >
                                    <Receipt className="h-3 w-3 mr-1" />
                                    CON FACTURA
                                  </Button>
                                </>
                              )}

                              {/* Paso 2 - Facturacion LiP (SIN FACTURA): Pago confirmado → cerrar */}
                              {orden.estadofactura === "SF - Pago confirmado" && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleRequestCerrarFacturacion(orden)}
                                  disabled={closingFacturacion}
                                  className="text-xs h-7 px-2"
                                >
                                  {closingFacturacion ? (
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  ) : (
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                  )}
                                  Cerrar Facturacion
                                </Button>
                              )}

                              {/* "Procesar Factura" OCULTO (petición del usuario): al cargar la factura
                                  Siigo la orden queda cerrada; los valores IVA/retefuente no se usan por
                                  ahora (se retomarán al integrar la API de Siigo). Para reactivarlo,
                                  restaurar el botón con estadofactura === "CF - Factura solicitada". */}
                              {false && orden.estadofactura === "CF - Factura solicitada" && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleRequestConfirmacion(orden)}
                                  className="text-xs h-7 px-2"
                                >
                                  <Receipt className="h-3 w-3 mr-1" />
                                  Procesar Factura
                                </Button>
                              )}

                              {/* Estados legacy: Facturado - por validar / A credito → Confirmar (flujo anterior) */}
                              {(orden.estadofactura === "Facturado - por validar" || orden.estadofactura === "A credito") && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleRequestConfirmacion(orden)}
                                  className="text-xs h-7 px-2"
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  Confirmar
                                </Button>
                              )}

                              {/* Factura SIIGO: disponible en todos los estados CON FACTURA (solicitada y cerrada) y en A credito (legacy) */}
                              {(orden.estadofactura === "CF - Factura solicitada" || orden.estadofactura === "CF - Cerrado" || orden.estadofactura === "A credito") && (
                                orden.facturasiigo ? (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => window.open(orden.facturasiigo!, "_blank")}
                                      className="text-xs h-7 px-2 text-green-600"
                                    >
                                      <FileText className="h-3 w-3 mr-1" />
                                      Ver Siigo
                                    </Button>
                                    {/* Eliminar factura Siigo — protegido por contraseña. */}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleRequestSiigo(orden, "eliminar")}
                                      className="text-xs h-7 px-2 text-red-600 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Eliminar
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRequestSiigo(orden, "montar")}
                                    disabled={uploadingFacturaSiigo && uploadingSiigoOrden?.id === orden.id}
                                    className="text-xs h-7 px-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                                  >
                                    {uploadingFacturaSiigo && uploadingSiigoOrden?.id === orden.id ? (
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    ) : (
                                      <Upload className="h-3 w-3 mr-1" />
                                    )}
                                    Factura Siigo
                                  </Button>
                                )
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-muted-foreground">
                    Mostrando {totalCount === 0 ? 0 : startIndex + 1} - {Math.min(startIndex + pageSize, totalCount)} de {totalCount.toLocaleString()}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(1)}
                      disabled={currentPage === 1 || loading}
                    >
                      Primera
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1 || loading}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm min-w-[100px] text-center">
                      Pagina {currentPage} de {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages || loading}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(totalPages)}
                      disabled={currentPage === totalPages || loading}
                    >
                      Ultima
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      </div>
  )

  // Registration Full Screen View
  const registrationView = (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {currentFlow === "sin_factura" ? "SIN FACTURA" : "CON FACTURA"} - Orden {selectedOrden?.ordendecargue}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleBackToList}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Volver al Listado
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Order Info Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 p-4 bg-muted/30 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Placa</p>
              <p className="font-medium text-sm">{selectedOrden?.placa || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transporte</p>
              <p className="font-medium text-sm">{selectedOrden?.transporte || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tipo Operacion</p>
              <p className="font-medium text-sm">{selectedOrden?.tipooperacion || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fecha Orden</p>
              <p className="font-medium text-sm">{formatDate(selectedOrden?.fechaorden || null)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Peso Orden</p>
              <p className="font-medium text-sm">{selectedOrden?.pesoorden?.toLocaleString() || "-"} kg</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Peso Bascula</p>
              <p className="font-medium text-sm">{selectedOrden?.pesovascula?.toLocaleString() || "-"} kg</p>
            </div>
          </div>

          {/* Detalles de Facturacion - Hidden but used for calculations */}
          {/* The detallesFacturacion data is still loaded and used for subtotal/IVA/retefuente calculations */}

          {/* Informational banner for CON FACTURA flow */}
          {currentFlow === "con_factura" && (
            <div className="p-4 rounded-lg border border-blue-200 bg-blue-50">
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-blue-900">Solicitud de Factura</p>
                  <p className="text-xs text-blue-700 mt-1">
                    En este flujo el Coordinador LiP consulta al cliente para definir medio de pago y cuenta, y anexa los soportes necesarios.
                    Los calculos de subtotal, IVA y retefuente seran definidos por Facturacion LiP en el siguiente paso.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Totals and Form - layout changes based on flow */}
          <div className={currentFlow === "sin_factura" ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
            {/* Totals Calculation - Only shown for SIN FACTURA flow */}
            {currentFlow === "sin_factura" && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Calculo de Totales
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal:</span>
                    <span className="font-medium">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>IVA:</span>
                    <span className="font-medium">{formatCurrency(ivaCalculado)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Retefuente:</span>
                    <span className="font-medium">{formatCurrency(retefuenteCalculado)}</span>
                  </div>
                  <div className="border-t pt-3 flex justify-between text-lg font-bold">
                    <span>Total a Cobrar:</span>
                    <span className="text-primary">{formatCurrency(subtotal + ivaCalculado + retefuenteCalculado)}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Form */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Informacion de Pago</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Medio de Pago - Solo visible en CON FACTURA.
                    En SIN FACTURA siempre es Contado (pago inmediato) por lo que no aparece seleccion. */}
                {currentFlow === "con_factura" && (
                  <div className="space-y-2">
                    <Label className="text-sm">Medio de Pago *</Label>
                    <RadioGroup
                      value={formData.mediopago}
                      onValueChange={(value) => setFormData({
                        ...formData,
                        mediopago: value,
                        aCredito: value === "Crédito",
                        cuentatransferencia: value === "Crédito" ? "" : formData.cuentatransferencia,
                      })}
                      className="flex gap-4"
                    >
                      <div className="flex items-center space-x-2 flex-1 p-3 rounded-lg border hover:bg-muted/30 cursor-pointer">
                        <RadioGroupItem value="Contado" id="mp-contado" />
                        <Label htmlFor="mp-contado" className="flex items-center gap-2 cursor-pointer font-normal">
                          <DollarSign className="h-4 w-4 text-green-600" />
                          Contado
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2 flex-1 p-3 rounded-lg border hover:bg-muted/30 cursor-pointer">
                        <RadioGroupItem value="Crédito" id="mp-credito" />
                        <Label htmlFor="mp-credito" className="flex items-center gap-2 cursor-pointer font-normal">
                          <CreditCard className="h-4 w-4 text-amber-600" />
                          Crédito
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                )}

                {/* Indicador de Contado en SIN FACTURA */}
                {currentFlow === "sin_factura" && (
                  <div className="flex items-center gap-2 p-3 rounded-lg border bg-green-50 border-green-200">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-900">
                      <span className="font-medium">Pago de Contado</span>
                      <span className="text-green-700"> - Todas las operaciones sin factura son de contado</span>
                    </span>
                  </div>
                )}

                {formData.mediopago === "Contado" && (
                  <div className="space-y-2">
                    <Label htmlFor="cuentatransferencia" className="text-sm">Cuenta de Transferencia *</Label>
                    <Select
                      value={formData.cuentatransferencia}
                      onValueChange={(value) => setFormData({ ...formData, cuentatransferencia: value })}
                    >
                      <SelectTrigger id="cuentatransferencia">
                        <SelectValue placeholder="Seleccionar cuenta" />
                      </SelectTrigger>
                      <SelectContent>
                        {CUENTAS_TRANSFERENCIA.map((cuenta) => (
                          <SelectItem key={cuenta} value={cuenta}>
                            {cuenta}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Observaciones — disponibles en ambos flujos (SIN FACTURA y CON FACTURA).
                    Se guardan en cabeceraoc.observacionesfactura. */}
                <div className="space-y-2">
                  <Label htmlFor="observacionesfactura" className="text-sm">
                    Observaciones
                  </Label>
                  <Textarea
                    id="observacionesfactura"
                    value={formData.observaciones}
                    onChange={(e) =>
                      setFormData({ ...formData, observaciones: e.target.value })
                    }
                    placeholder={
                      currentFlow === "sin_factura"
                        ? "Notas internas sobre el pago o la operacion (opcional)"
                        : "Notas para Facturacion - datos del cliente, orden de compra, etc. (opcional)"
                    }
                    rows={3}
                    className="resize-y"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">
                    {currentFlow === "sin_factura" ? "Comprobantes de Pago" : "Anexos / Soportes"}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {currentFlow === "sin_factura"
                      ? "Adjunte los comprobantes de pago recibidos. Puede seleccionar varios archivos (imagenes o PDF)."
                      : "Adjunte soportes necesarios - orden de compra, remision, RUT, etc. Puede seleccionar varios archivos (imagenes o PDF)."}
                  </p>

                  {/* Hidden file inputs.
                      El input de galeria acepta imagenes y PDF (por ejemplo el RUT
                      se suele enviar en PDF porque en imagen queda ilegible) y
                      permite seleccion multiple.
                      El input de camara sigue siendo solo imagen y no multiple
                      porque captura una foto por vez. */}
                  {/* Importante: NO usamos `display: none` (la clase
                      `hidden`) en estos inputs. En iOS Safari, los
                      inputs ocultos con `display: none` a veces NO
                      disparan el evento `change` tras tomar la foto
                      con `capture="environment"`. Los mantenemos en el
                      DOM pero invisibles e inaccesibles, manteniendo el
                      patron Trigger Button → input.click(). */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/*,application/pdf"
                    multiple
                    className="sr-only"
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  <input
                    type="file"
                    ref={cameraInputRef}
                    onChange={handleFileChange}
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    aria-hidden="true"
                    tabIndex={-1}
                  />

                  {/* Display existing anexos (imagenes y PDFs) */}
                  {comprobanteUrls.length > 0 && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        {comprobanteUrls.map((url, index) => {
                          const esPdf = isPdfUrl(url)
                          return (
                            <div key={index} className="relative rounded-lg border overflow-hidden bg-muted/30">
                              {esPdf ? (
                                <button
                                  type="button"
                                  className="w-full h-24 flex flex-col items-center justify-center gap-1 bg-red-50 hover:bg-red-100 transition-colors"
                                  onClick={() => {
                                    setViewingComprobanteIndex(index)
                                    setViewingComprobante(selectedOrden)
                                  }}
                                  aria-label={`Ver PDF ${index + 1}`}
                                >
                                  <FileText className="h-8 w-8 text-red-600" />
                                  <span className="text-xs font-medium text-red-700">PDF {index + 1}</span>
                                </button>
                              ) : (
                                <img
                                  src={url}
                                  alt={`Anexo ${index + 1}`}
                                  className="w-full h-24 object-cover cursor-pointer"
                                  onClick={() => {
                                    setViewingComprobanteIndex(index)
                                    setViewingComprobante(selectedOrden)
                                  }}
                                />
                              )}
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute top-1 right-1 h-6 w-6"
                                onClick={() => handleRemoveComprobante(index)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-green-600">
                        <CheckCircle className="h-3.5 w-3.5" />
                        <span>{comprobanteUrls.length} archivo{comprobanteUrls.length > 1 ? 's' : ''} adjuntado{comprobanteUrls.length > 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  )}

                  {/* Upload buttons - always visible to add more.
                      Estos botones NO dependen del medio de pago (Contado/Credito): siempre estan disponibles. */}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingComprobante}
                      className="flex-1"
                    >
                      {uploadingComprobante ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Image className="mr-2 h-4 w-4" />
                      )}
                      {comprobanteUrls.length > 0 ? 'Agregar' : 'Galeria'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={uploadingComprobante}
                      className="flex-1"
                    >
                      {uploadingComprobante ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="mr-2 h-4 w-4" />
                      )}
                      Camara
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleBackToList} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveFacturacion}
              disabled={saving || (currentFlow === "sin_factura" && detallesFacturacion.length === 0)}
              size="lg"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : currentFlow === "sin_factura" ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  CONFIRMAR PAGO
                </>
              ) : (
                <>
                  <Receipt className="mr-2 h-4 w-4" />
                  SOLICITAR FACTURA
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  // Confirmacion View
  const confirmacionViewComponent = ordenConfirmacion && (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              {ordenConfirmacion.estadofactura === "CF - Factura solicitada"
                ? `Procesar Factura (Facturacion LiP) - Orden ${ordenConfirmacion.ordendecargue}`
                : `Confirmar Pago - Orden ${ordenConfirmacion.ordendecargue}`}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleBackFromConfirmacion}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Volver al Listado
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Order Info Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Orden de Cargue</p>
              <p className="font-medium text-sm">{ordenConfirmacion.ordendecargue}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Placa</p>
              <p className="font-medium text-sm">{ordenConfirmacion.placa || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Transporte</p>
              <p className="font-medium text-sm">{ordenConfirmacion.transporte || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tipo Operacion</p>
              <p className="font-medium text-sm">{ordenConfirmacion.tipooperacion || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fecha Orden</p>
              <p className="font-medium text-sm">{formatDate(ordenConfirmacion.fechaorden)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Estado Actual</p>
              <p className="font-medium text-sm">{getEstadoBadge(ordenConfirmacion.estadofactura)}</p>
            </div>
          </div>

          {/* Product Details */}
          <div>
            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Detalle de Productos y Valores
            </h4>
            {loadingDetallesConfirmacion ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : detallesConfirmacion.length === 0 ? (
              <div className="text-center py-4 border rounded-lg bg-muted/20">
                <p className="text-sm text-muted-foreground">
                  No se encontraron detalles de facturacion para esta orden.
                </p>
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="text-xs font-semibold">Producto</TableHead>
                      <TableHead className="text-xs font-semibold">Subcategoria</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Toneladas</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Tarifa</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Valor a Facturar</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detallesConfirmacion.map((detalle, index) => (
                      <TableRow key={index}>
                        <TableCell className="text-sm">{detalle.producto}</TableCell>
                        <TableCell className="text-sm">{detalle.subcategoria}</TableCell>
                        <TableCell className="text-sm text-right">{detalle.toneladas?.toLocaleString()}</TableCell>
                        <TableCell className="text-sm text-right">{formatCurrencyTarifa(detalle.tarifa)}</TableCell>
                        <TableCell className="text-sm text-right font-medium">{formatCurrency(detalle.valor_a_facturar)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-semibold">
                      <TableCell colSpan={4} className="text-sm text-right">Subtotal:</TableCell>
                      <TableCell className="text-sm text-right">
                        {formatCurrency(detallesConfirmacion.reduce((sum, d) => sum + (parseFloat(String(d.valor_a_facturar)) || 0), 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Payment Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Informacion de Pago
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="confirm-cliente" className="text-sm">
                    Cliente <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="confirm-cliente"
                    value={confirmacionFormData.cliente}
                    onChange={(e) => setConfirmacionFormData({ ...confirmacionFormData, cliente: e.target.value })}
                    placeholder="Nombre del cliente"
                    required
                    aria-required="true"
                  />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Medio de Pago:</span>
                  <span className="font-medium">{ordenConfirmacion.mediopago || "-"}</span>
                </div>
                {/* Cuenta Transferencia: ahora es un selector disponible tambien para pagos a Credito,
                    para que se pueda registrar la cuenta en la que se recibira el pago al cerrar la factura. */}
                <div className="space-y-2">
                  <Label htmlFor="confirm-cuenta" className="text-sm">Cuenta Transferencia</Label>
                  <Select
                    value={confirmacionFormData.cuentatransferencia}
                    onValueChange={(value) => setConfirmacionFormData({ ...confirmacionFormData, cuentatransferencia: value })}
                  >
                    <SelectTrigger id="confirm-cuenta">
                      <SelectValue placeholder="Seleccionar cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      {CUENTAS_TRANSFERENCIA.map((cuenta) => (
                        <SelectItem key={cuenta} value={cuenta}>
                          {cuenta}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/*
                  Calculo de subtotal/IVA/retefuente:
                  - Si hay detalles cargados (caso CON FACTURA) usamos la sumatoria de valor_a_facturar como base.
                  - Si no hay detalles pero existe valorpago (caso legacy SIN FACTURA ya registrado),
                    derivamos el subtotal asumiendo que valorpago incluye IVA.
                */}
                {(() => {
                  // Empresas 1 y 2: el subtotal viene del backend como MAX(peso_bascula) * MAX(tarifa)
                  // y reemplaza directamente la suma de detalles.
                  const subtotalFromDetalles = detallesConfirmacion.reduce(
                    (sum, d) => sum + (parseFloat(String(d.valor_a_facturar)) || 0),
                    0
                  )
                  const subtotalBase = totalCalculadoConfirmacion !== null
                    ? totalCalculadoConfirmacion
                    : subtotalFromDetalles > 0
                      ? subtotalFromDetalles
                      : (ordenConfirmacion.valorpago || 0) / (1 + confirmacionFormData.ivaPorcentaje / 100)
                  const ivaValor = subtotalBase * (confirmacionFormData.ivaPorcentaje / 100)
                  const retefuenteValor = subtotalBase * (confirmacionFormData.retefuentePorcentaje / 100)
                  const totalValor = subtotalBase + ivaValor - retefuenteValor

                  return (
                    <>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">IVA (%)</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={confirmacionFormData.ivaPorcentaje}
                            onChange={(e) => setConfirmacionFormData({ ...confirmacionFormData, ivaPorcentaje: parseFloat(e.target.value) || 0 })}
                            placeholder="19"
                            className="w-24"
                            min={0}
                            max={100}
                            step={0.5}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                          <span className="text-sm font-medium ml-auto">
                            {formatCurrency(ivaValor)}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm text-muted-foreground">Retefuente (%)</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            value={confirmacionFormData.retefuentePorcentaje}
                            onChange={(e) => setConfirmacionFormData({ ...confirmacionFormData, retefuentePorcentaje: parseFloat(e.target.value) || 0 })}
                            placeholder="0"
                            className="w-24"
                            min={0}
                            max={100}
                            step={0.5}
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                          <span className="text-sm font-medium text-red-600 ml-auto">
                            - {formatCurrency(retefuenteValor)}
                          </span>
                        </div>
                      </div>
                      {/* Resumen de valores */}
                      <div className="border-t pt-3 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal:</span>
                          <span className="font-medium">{formatCurrency(subtotalBase)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">IVA ({confirmacionFormData.ivaPorcentaje}%):</span>
                          <span className="font-medium">{formatCurrency(ivaValor)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Retefuente ({confirmacionFormData.retefuentePorcentaje}%):</span>
                          <span className="font-medium text-red-600">- {formatCurrency(retefuenteValor)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold pt-2 border-t">
                          <span>Valor Total:</span>
                          <span className="text-primary">{formatCurrency(totalValor)}</span>
                        </div>
                      </div>
                    </>
                  )
                })()}
              </CardContent>
            </Card>

            {/* Anexos / Soportes Preview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Image className="h-4 w-4" />
                  Anexos / Soportes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  // Parse anexos URLs (puede ser JSON array o string unico)
                  let anexosUrls: string[] = []
                  if (ordenConfirmacion.comprobante) {
                    try {
                      const parsed = JSON.parse(ordenConfirmacion.comprobante)
                      anexosUrls = Array.isArray(parsed) ? parsed : [ordenConfirmacion.comprobante]
                    } catch {
                      anexosUrls = [ordenConfirmacion.comprobante]
                    }
                  }

                  if (anexosUrls.length === 0) {
                    return (
                      <div className="flex items-center justify-center h-40 border rounded-lg bg-muted/20">
                        <p className="text-sm text-muted-foreground">No hay anexos adjuntos</p>
                      </div>
                    )
                  }

                  return (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {anexosUrls.map((url, index) => {
                          const esPdf = isPdfUrl(url)
                          return (
                            <div
                              key={index}
                              className="rounded-lg border overflow-hidden bg-muted/30 cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() => {
                                setViewingComprobanteIndex(index)
                                setViewingComprobante(ordenConfirmacion)
                              }}
                            >
                              {esPdf ? (
                                <div className="w-full h-28 flex flex-col items-center justify-center gap-1 bg-red-50">
                                  <FileText className="h-8 w-8 text-red-600" />
                                  <span className="text-xs font-medium text-red-700">PDF {index + 1}</span>
                                </div>
                              ) : (
                                <img
                                  src={url}
                                  alt={`Anexo ${index + 1}`}
                                  className="w-full h-28 object-cover"
                                />
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <p className="text-xs text-center text-muted-foreground">
                        {anexosUrls.length} archivo{anexosUrls.length > 1 ? 's' : ''} adjuntado{anexosUrls.length > 1 ? 's' : ''} - haz clic para ver en detalle
                      </p>
                    </>
                  )
                })()}
              </CardContent>
            </Card>
          </div>

          {/* Confirm Button */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleBackFromConfirmacion} disabled={confirmingPayment}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmPayment} disabled={confirmingPayment} size="lg" className="bg-green-600 hover:bg-green-700">
              {confirmingPayment ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : ordenConfirmacion.estadofactura === "CF - Factura solicitada" ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  CERRAR FACTURACION
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Confirmar Pago Recibido
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )

  // Parse comprobante URLs for viewer
  const getComprobanteUrlsForViewer = (orden: OrdenCargue | null): string[] => {
    if (!orden?.comprobante) return []
    try {
      const parsed = JSON.parse(orden.comprobante)
      return Array.isArray(parsed) ? parsed : [orden.comprobante]
    } catch {
      return [orden.comprobante]
    }
  }

  const viewerUrls = getComprobanteUrlsForViewer(viewingComprobante)

  // Comprobante Viewer Dialog with navigation for multiple images
  const comprobanteDialog = viewingComprobante && viewerUrls.length > 0 && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setViewingComprobante(null)}>
      <div className="relative max-w-4xl max-h-[90vh] p-4" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 z-10 bg-white/10 hover:bg-white/20 text-white"
          onClick={() => setViewingComprobante(null)}
        >
          <X className="h-5 w-5" />
        </Button>
        <div className="text-center text-white mb-2">
          <p className="text-sm">Comprobante - Orden {viewingComprobante.ordendecargue}</p>
          {viewerUrls.length > 1 && (
            <p className="text-xs text-white/70">{viewingComprobanteIndex + 1} de {viewerUrls.length}</p>
          )}
        </div>
        <div className="relative">
          {isPdfUrl(viewerUrls[viewingComprobanteIndex]) ? (
            <div className="bg-white rounded-lg overflow-hidden">
              <iframe
                src={viewerUrls[viewingComprobanteIndex]}
                title={`Comprobante ${viewingComprobanteIndex + 1}`}
                className="w-[90vw] max-w-4xl h-[80vh]"
              />
              <div className="flex items-center justify-center gap-2 bg-muted/50 py-2">
                <a
                  href={viewerUrls[viewingComprobanteIndex]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary underline flex items-center gap-1"
                >
                  <Download className="h-3.5 w-3.5" />
                  Abrir PDF en nueva pestaña
                </a>
              </div>
            </div>
          ) : (
            <img
              src={viewerUrls[viewingComprobanteIndex]}
              alt={`Comprobante ${viewingComprobanteIndex + 1}`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
          )}
          {viewerUrls.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white"
                onClick={() => setViewingComprobanteIndex((prev) => (prev === 0 ? viewerUrls.length - 1 : prev - 1))}
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white"
                onClick={() => setViewingComprobanteIndex((prev) => (prev === viewerUrls.length - 1 ? 0 : prev + 1))}
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            </>
          )}
        </div>
        {/* Thumbnail navigation */}
        {viewerUrls.length > 1 && (
          <div className="flex justify-center gap-2 mt-4">
            {viewerUrls.map((url, index) => (
              <button
                key={index}
                onClick={() => setViewingComprobanteIndex(index)}
                className={`w-12 h-12 rounded border-2 overflow-hidden ${index === viewingComprobanteIndex ? 'border-white' : 'border-transparent opacity-60'}`}
              >
                {isPdfUrl(url) ? (
                  <div className="w-full h-full flex items-center justify-center bg-red-50">
                    <FileText className="h-5 w-5 text-red-600" />
                  </div>
                ) : (
                  <img src={url} alt={`Thumb ${index + 1}`} className="w-full h-full object-cover" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // Main return - switch between views
  if (!selectedEmpresaId) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">Seleccione una empresa para ver las facturas.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {confirmacionView && ordenConfirmacion ? confirmacionViewComponent : currentView === "register" ? registrationView : listView}
      {comprobanteDialog}

      {/* Password Dialog for Confirmation Access */}
      <Dialog open={showPasswordDialog} onOpenChange={(open) => {
        if (!open) {
          setShowPasswordDialog(false)
          setPasswordInput("")
          setPasswordError(false)
          setPendingOrdenConfirmacion(null)
          setPendingSiigo(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Acceso Protegido
            </DialogTitle>
            <DialogDescription>
              {pendingSiigo
                ? pendingSiigo.accion === "eliminar"
                  ? "Ingrese la contraseña para ELIMINAR la factura Siigo de esta orden."
                  : "Ingrese la contraseña para MONTAR la factura Siigo de esta orden."
                : "Ingrese la contrasena para acceder a la confirmacion de pago."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="password">Contrasena</Label>
              <Input
                id="password"
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value)
                  setPasswordError(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handlePasswordSubmit()
                  }
                }}
                placeholder="Ingrese la contrasena"
                className={passwordError ? "border-red-500" : ""}
              />
              {passwordError && (
                <p className="text-sm text-red-500">Contrasena incorrecta</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowPasswordDialog(false)
              setPasswordInput("")
              setPasswordError(false)
              setPendingOrdenConfirmacion(null)
              setPendingSiigo(null)
            }}>
              Cancelar
            </Button>
            <Button onClick={handlePasswordSubmit}>
              Acceder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Dialog for Cerrar Facturacion (SIN FACTURA flow) */}
      <Dialog open={showCerrarPasswordDialog} onOpenChange={(open) => {
        if (!open) {
          setShowCerrarPasswordDialog(false)
          setPasswordInput("")
          setPasswordError(false)
          setPendingCerrarOrden(null)
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Cerrar Facturacion
            </DialogTitle>
            <DialogDescription>
              Ingrese la contrasena para cerrar la facturacion. Esta accion es responsabilidad de Facturacion LiP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cerrar-password">Contrasena</Label>
              <Input
                id="cerrar-password"
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value)
                  setPasswordError(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCerrarPasswordSubmit()
                  }
                }}
                placeholder="Ingrese la contrasena"
                className={passwordError ? "border-red-500" : ""}
              />
              {passwordError && (
                <p className="text-sm text-red-500">Contrasena incorrecta</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowCerrarPasswordDialog(false)
              setPasswordInput("")
              setPasswordError(false)
              setPendingCerrarOrden(null)
            }}>
              Cancelar
            </Button>
            <Button onClick={handleCerrarPasswordSubmit}>
              Cerrar Facturacion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
