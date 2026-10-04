"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  RefreshCw,
  FileText,
  CheckSquare,
  Package,
  Check,
  ArrowLeft,
  Camera,
  AlertTriangle,
  Pause,
  Play,
} from "lucide-react"
import {
  getPendingLoadOrders,
  type PendingLoadOrder,
  generatePickingPDF,
  getPickingItems,
  type PickingItem,
  confirmPicking,
  registerQRPickingMovements,
  type QRPalletInfo,
  pausarOrden,
  reanudarOrden,
  getOrdenesPausadas,
} from "@/lib/picking-actions"
import { justificacionValida, JUSTIFICACION_MINIMA } from "@/lib/picking-estado"
import { FacturarCheckbox } from "@/components/facturar-checkbox"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useIsMobile } from "@/components/qr-camera-scanner"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { QRCameraScanner } from "@/components/qr-camera-scanner"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { useAuth } from "@/components/auth-provider"
import { PickingPhotoUploadDialog } from "@/components/picking-photo-upload-dialog"

interface ExtendedPickingItem extends PickingItem {
  verificationType?: "simple" | "qr"
  qrScans?: Array<{
    idqr: number
    codproducto: string
    cantidad: number
    location: string
    allProductsInQR?: any[] // Added to store all products from the QR scan
  }>
  qrAccumulatedQuantity?: number
}

function Picking({
  initialOrderId = null,
  onInitialOrderOpened,
}: {
  // Orden con la que llega el coordinador desde Centro de Coordinación
  // ("Ir a Picking"): se abre directo su verificación línea por línea.
  initialOrderId?: number | null
  onInitialOrderOpened?: () => void
} = {}) {
  const { toast } = useToast()
  const { profile, selectedEmpresaId } = useAuth()
  const [orders, setOrders] = useState<PendingLoadOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingPDF, setGeneratingPDF] = useState<number | null>(null)

  const [selectedOrder, setSelectedOrder] = useState<PendingLoadOrder | null>(null)

  const [ordersWithPhotos, setOrdersWithPhotos] = useState<Set<number>>(new Set())

  const [showPickingView, setShowPickingView] = useState(false)
  const [pickingItems, setPickingItems] = useState<ExtendedPickingItem[]>([])
  const [verifiedItems, setVerifiedItems] = useState<Set<number>>(new Set())
  const [editedQuantities, setEditedQuantities] = useState<Map<number, number>>(new Map())
  const [loadingPicking, setLoadingPicking] = useState(false)
  const [confirmingPicking, setConfirmingPicking] = useState(false)

  const [scanningItemId, setScanningItemId] = useState<number | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanSuccess, setScanSuccess] = useState<number | null>(null)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [currentScanningItem, setCurrentScanningItem] = useState<PickingItem | null>(null) // Changed back to PickingItem for simple scan
  const [scannedLocations, setScannedLocations] = useState<Map<number, string>>(new Map())

  const [qrPickingMode, setQRPickingMode] = useState<Map<number, "simple" | "qr">>(new Map())
  const [qrScanningForItem, setQRScanningForItem] = useState<number | null>(null)
  const [qrScannedPallets, setQRScannedPallets] = useState<Map<number, QRPalletInfo[]>>(new Map())
  const [qrAccumulatedQuantities, setQRAccumulatedQuantities] = useState<Map<number, number>>(new Map())
  const [isQRCameraOpen, setIsQRCameraOpen] = useState(false)

  // --- Averías y Lote alterno ---
  // Filas de invtrans con status "Lote alterno" disponibles para esta orden.
  const [alternoItems, setAlternoItems] = useState<PickingItem[]>([])
  // Items para los que el usuario activó el escaneo de lote alterno.
  const [alternoModeItems, setAlternoModeItems] = useState<Set<number>>(new Set())
  // Estibas escaneadas desde el inventario alterno, por item.
  const [alternoScannedPallets, setAlternoScannedPallets] = useState<Map<number, QRPalletInfo[]>>(new Map())
  // Indica si la sesión de escaneo actual es para lote alterno.
  const [scanningAlterno, setScanningAlterno] = useState(false)

  // --- Averías y Lote alterno en modo SIMPLE (sin QR) ---
  // Averías reportadas sobre el lote principal de la línea (modo simple).
  const [simpleAverias, setSimpleAverias] = useState<Map<number, number>>(new Map())
  /** Motivo del FALTANTE por línea. Obligatorio cuando se envía menos de lo que piden. */
  const [justificaciones, setJustificaciones] = useState<Map<number, string>>(new Map())
  /** Lo que se escribe en el diálogo de cantidad menor, antes de guardarlo en la línea. */
  const [motivoFaltante, setMotivoFaltante] = useState("")
  // Selecciones de lote alterno (modo simple): por item, una lista de
  // { alternoId, lote, location, cantidad, averias }.
  const [simpleAlterno, setSimpleAlterno] = useState<
    Map<number, { alternoId: number; lote: string; location: string; cantidad: number; averias: number }[]>
  >(new Map())
  // Abre específicamente el escáner por cámara (componente
  // QRCameraScanner). Se mantiene separado de `isQRCameraOpen` (que abre
  // el diálogo de escaneo de estiba con entrada manual + botón cámara).
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false)
  // Valor del número de QR de estiba ingresado manualmente.
  const [manualQR, setManualQR] = useState("")

  // Confirmación al verificar una cantidad menor a la del pedido.
  const [lowQtyConfirm, setLowQtyConfirm] = useState<{
    itemId: number
    net: number
    required: number
    mode: "simple" | "qr"
  } | null>(null)

  const [photoDialogOpen, setPhotoDialogOpen] = useState(false)
  const [selectedPhotosOrder, setSelectedPhotosOrder] = useState<PendingLoadOrder | null>(null)

  // Numeros de orden (ordendecargue) que tienen una pausa activa.
  const [pausedOrders, setPausedOrders] = useState<Set<string>>(new Set())
  // Orden cuyo boton pausar/reanudar esta procesando.
  const [pausingOrder, setPausingOrder] = useState<string | null>(null)

  const isMobile = useIsMobile()

const loadOrders = async () => {
  setLoading(true)
  const result = await getPendingLoadOrders(selectedEmpresaId)

    if (result.success) {
      setOrders(result.data)
      // Populate ordersWithPhotos from initial load if data is available
      const photosExist = result.data.filter((order: any) => order.photos_count > 0).map((order: any) => order.id)
      setOrdersWithPhotos(new Set(photosExist))
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }

    // Cargar las ordenes que tienen una pausa activa para mostrar Reanudar.
    const pausadas = await getOrdenesPausadas()
    setPausedOrders(new Set(pausadas))

    setLoading(false)
  }

  const handleTogglePausa = async (order: PendingLoadOrder) => {
    const ordenCargue = order.ordendecargue
    const estaPausada = pausedOrders.has(ordenCargue)
    setPausingOrder(ordenCargue)

    const result = estaPausada ? await reanudarOrden(ordenCargue) : await pausarOrden(ordenCargue)

    if (result.success) {
      setPausedOrders((prev) => {
        const next = new Set(prev)
        if (estaPausada) next.delete(ordenCargue)
        else next.add(ordenCargue)
        return next
      })
      toast({ title: estaPausada ? "Cargue reanudado" : "Cargue pausado", description: result.message })
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }

    setPausingOrder(null)
  }

  useEffect(() => {
    if (selectedEmpresaId) {
      loadOrders()
    }
  }, [selectedEmpresaId])

  // Salto con dato desde Centro de Coordinación ("Ir a Picking"): el
  // coordinador llega con una orden puntual y se le abre directo la
  // verificación línea por línea. Si la orden ya no está pendiente (cerrada o
  // sin lote), se avisa y se queda en la lista. El atajo "Confirmar Picking"
  // por excepción del Centro de Coordinación se retiró el 2026-10-02: en la
  // última semana de septiembre (ID3) 192 de 209 salidas se confirmaron así,
  // sin verificar lote ni cantidad, y el conteo del 1-oct no cuadró.
  useEffect(() => {
    if (!initialOrderId || loading) return
    const orden = orders.find((o) => o.id === initialOrderId)
    if (orden) {
      void handlePerformPicking(orden)
    } else {
      toast({
        title: "La orden no está pendiente de picking",
        description: "Ya se cerró o aún no tiene lote asignado; no hay líneas para verificar aquí.",
        variant: "destructive",
      })
    }
    onInitialOrderOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderId, loading, orders])

  /**
   * Modo de verificacion EFECTIVO de una linea. Todas arrancan en "simple",
   * incluidas las que tienen stock en estibas con QR: para esas se muestra un
   * aviso, pero se puede descontar sin escanear.
   *
   * Vive en un solo lugar porque las dos vistas (escritorio y movil) lo
   * derivaban por separado y podian quedar desalineadas.
   */
  const modoDeItem = (item: ExtendedPickingItem): "simple" | "qr" =>
    qrPickingMode.get(item.id) ?? "simple"

  const handleVerificationModeChange = (itemId: number, mode: "simple" | "qr") => {
    setQRPickingMode((prev) => {
      const newMap = new Map(prev)
      newMap.set(itemId, mode)
      return newMap
    })

    // Reset verification if changing mode
    setVerifiedItems((prev) => {
      const newSet = new Set(prev)
      newSet.delete(itemId)
      return newSet
    })

    // Reset QR scans if switching away from QR mode
    if (mode === "simple") {
      setQRScannedPallets((prev) => {
        const newMap = new Map(prev)
        newMap.delete(itemId)
        return newMap
      })
      setQRAccumulatedQuantities((prev) => {
        const newMap = new Map(prev)
        newMap.delete(itemId)
        return newMap
      })
    }
  }

  const handleStartQRScanning = (item: ExtendedPickingItem) => {
    setScanningAlterno(false)
    setQRScanningForItem(item.id)
    setCurrentScanningItem(item as any) // This should be ExtendedPickingItem
    setIsQRCameraOpen(true)
    setScanError(null)
  }

  // Inicia el escaneo de estibas desde el inventario marcado como "Lote alterno".
  const handleStartAlternoScanning = (item: ExtendedPickingItem) => {
    setAlternoModeItems((prev) => new Set(prev).add(item.id))
    setScanningAlterno(true)
    setQRScanningForItem(item.id)
    setCurrentScanningItem(item as any)
    setIsQRCameraOpen(true)
    setScanError(null)
  }

  // Cantidad NETA cargada para un item: total escaneado (normal + alterno)
  // menos las averías reportadas en cada estiba.
  const getNetForItem = (itemId: number) => {
    const normal = qrScannedPallets.get(itemId) || []
    const alterno = alternoScannedPallets.get(itemId) || []
    const sumNet = (scans: QRPalletInfo[]) =>
      scans.reduce(
        (acc, s) => acc + (((s as any).quantityTaken ?? s.stock_total) - ((s as any).averias || 0)),
        0,
      )
    return sumNet(normal) + sumNet(alterno)
  }

  // Total de averías reportadas para un item (normal + alterno).
  const getAveriasForItem = (itemId: number) => {
    const normal = qrScannedPallets.get(itemId) || []
    const alterno = alternoScannedPallets.get(itemId) || []
    const sumAv = (scans: QRPalletInfo[]) => scans.reduce((acc, s) => acc + ((s as any).averias || 0), 0)
    return sumAv(normal) + sumAv(alterno)
  }

  // Actualiza las averías de una estiba escaneada (normal o alterna).
  const updateScanAveria = (itemId: number, idqr: number, value: number, isAlterno: boolean) => {
    const setter = isAlterno ? setAlternoScannedPallets : setQRScannedPallets
    setter((prev) => {
      const newMap = new Map(prev)
      const scans = (newMap.get(itemId) || []).map((s) => {
        if (s.idqr === idqr) {
          const max = (s as any).quantityTaken ?? s.stock_total
          const averias = Math.max(0, Math.min(max, value || 0))
          return { ...s, averias } as QRPalletInfo
        }
        return s
      })
      newMap.set(itemId, scans)
      return newMap
    })
  }

  // Estibas alternas disponibles que coinciden con el producto de la línea.
  const getAlternoOptionsForItem = (item: ExtendedPickingItem) =>
    alternoItems.filter((a) => a.nombreproducto === item.nombreproducto)

  // Envía el número de QR de estiba ingresado manualmente, reutilizando
  // la misma lógica de búsqueda/acumulado que el escaneo por cámara.
  const handleManualQRSubmit = () => {
    const code = manualQR.trim()
    if (!code) return
    handleQRPickingScanned(code)
    setManualQR("")
  }

  const handleQRPickingScanned = async (scannedCode: string) => {
    console.log("[v0] handleQRPickingScanned called with code:", scannedCode)
    console.log("[v0] currentScanningItem:", currentScanningItem)

    if (!currentScanningItem) {
      console.log("[v0] No currentScanningItem, returning early")
      return
    }

    const itemId = currentScanningItem.id
    const requiredQuantity = editedQuantities.get(itemId) ?? currentScanningItem.cantidad
    const currentAccumulated = qrAccumulatedQuantities.get(itemId) || 0

    console.log("[v0] Searching for QR:", scannedCode)
    console.log(
      "[v0] itemId:",
      itemId,
      "requiredQuantity:",
      requiredQuantity,
      "currentAccumulated:",
      currentAccumulated,
    )

    // Search for pallet information.
    // Se consume vía Route Handler (fetch) en lugar de Server Action para
    // evitar errores de "Server Action not found" por desincronización de
    // despliegue (deployment skew).
    let result: { success: boolean; data: QRPalletInfo[]; error?: string }
    try {
      const response = await fetch(
        `/api/pallet-inventory/by-qr?idqr=${encodeURIComponent(scannedCode.trim())}`,
      )
      result = await response.json()
    } catch (err) {
      console.log("[v0] Error fetching QR info:", err)
      setScanError("Error al buscar la información de la estiba")
      toast({
        title: "Error",
        description: "Error al buscar la información de la estiba",
        variant: "destructive",
      })
      return
    }

    console.log("[v0] Search result:", result)

    if (!result.success || !result.data || result.data.length === 0) {
      console.log("[v0] No data found for QR")
      setScanError("No se encontró información para este código QR")
      toast({
        title: "Error",
        description: "Código QR no encontrado en el inventario",
        variant: "destructive",
      })
      return
    }

    console.log("[v0] Found pallets:", result.data)

    // Determinar la estiba que coincide y, en modo alterno, a qué fila
    // de inventario "Lote alterno" pertenece.
    let matchingPallet: QRPalletInfo | undefined
    let matchedAlternoId: number | undefined

    if (scanningAlterno) {
      // En alterno la estiba debe corresponder al mismo PRODUCTO de la línea
      // pero a un lote alterno disponible (status "Lote alterno" en invtrans).
      const alternoOptions = getAlternoOptionsForItem(currentScanningItem as ExtendedPickingItem)
      for (const pallet of result.data) {
        const match = alternoOptions.find(
          (a) =>
            a.nombreproducto === pallet.nombreproducto &&
            a.lote === pallet.lote &&
            a.location === pallet.location,
        )
        if (match) {
          matchingPallet = pallet
          matchedAlternoId = match.id
          break
        }
      }

      if (!matchingPallet || matchedAlternoId === undefined) {
        setScanError("El QR no corresponde a un lote alterno disponible para este producto")
        toast({
          title: "Error",
          description: "El QR no corresponde a un lote alterno disponible",
          variant: "destructive",
        })
        return
      }
    } else {
      matchingPallet = result.data.find(
        (pallet) =>
          pallet.nombreproducto === currentScanningItem.nombreproducto && pallet.lote === currentScanningItem.lote,
      )

      if (!matchingPallet) {
        setScanError("El código QR no corresponde al producto y lote esperado")
        toast({
          title: "Error",
          description: "El QR no coincide con el producto/lote de esta línea",
          variant: "destructive",
        })
        return
      }
    }

    // Evitar duplicados (revisa tanto estibas normales como alternas).
    const existingNormal = qrScannedPallets.get(itemId) || []
    const existingAlterno = alternoScannedPallets.get(itemId) || []
    if ([...existingNormal, ...existingAlterno].some((scan) => scan.idqr === matchingPallet!.idqr)) {
      setScanError("Este código QR ya fue escaneado para esta línea")
      toast({
        title: "Error",
        description: "QR duplicado",
        variant: "destructive",
      })
      return
    }

    // La SALIDA registra la estiba completa (regla de negocio); las averías
    // se restan después para obtener la cantidad neta cargada a la orden.
    const quantityToTake = matchingPallet.stock_total

    const newScan: QRPalletInfo = {
      ...matchingPallet,
      ...( { quantityTaken: quantityToTake, averias: 0, allProductsInQR: result.data } as any ),
      ...(scanningAlterno ? ({ alternoId: matchedAlternoId } as any) : {}),
    }

    if (scanningAlterno) {
      setAlternoScannedPallets((prev) => {
        const newMap = new Map(prev)
        const scans = newMap.get(itemId) || []
        newMap.set(itemId, [...scans, newScan])
        return newMap
      })
    } else {
      setQRScannedPallets((prev) => {
        const newMap = new Map(prev)
        const scans = newMap.get(itemId) || []
        newMap.set(itemId, [...scans, newScan])
        return newMap
      })
      setQRAccumulatedQuantities((prev) => {
        const newMap = new Map(prev)
        newMap.set(itemId, (newMap.get(itemId) || 0) + quantityToTake)
        return newMap
      })
    }

    // Acumulado NETO con esta nueva estiba (averías = 0 al recién escanear).
    const newNet = getNetForItem(itemId) + quantityToTake

    if (newNet >= requiredQuantity) {
      // Se alcanzó la cantidad: cerramos la cámara por comodidad, pero la
      // verificación se confirma explícitamente (las averías pueden cambiar
      // el neto y requerir más estibas o lote alterno).
      toast({
        title: "Cantidad alcanzada",
        description: `Neto ${newNet}/${requiredQuantity} para ${currentScanningItem.nombreproducto}. Revise averías y confirme.`,
      })
      setIsQRCameraOpen(false)
      setQRScanningForItem(null)
      setCurrentScanningItem(null)
    } else {
      toast({
        title: "QR Escaneado",
        description: `${quantityToTake} unidades agregadas. Neto: ${newNet}/${requiredQuantity}`,
      })
    }
  }

  // --- Helpers para averías y lote alterno en modo SIMPLE ---

  // Averías reportadas sobre el lote principal de la línea.
  const getSimpleMainAverias = (itemId: number) => simpleAverias.get(itemId) || 0

  // Selecciones de lote alterno de la línea (modo simple).
  const getSimpleAlternoSelections = (itemId: number) => simpleAlterno.get(itemId) || []

  // Neto del lote principal = cantidad escogida - averías del principal.
  const getSimpleMainNet = (itemId: number, currentQuantity: number) =>
    currentQuantity - getSimpleMainAverias(itemId)

  // Neto aportado por los lotes alternos = suma de (cantidad - averías).
  const getSimpleAlternoNet = (itemId: number) =>
    getSimpleAlternoSelections(itemId).reduce((acc, s) => acc + (s.cantidad - (s.averias || 0)), 0)

  // Neto total cargado a la orden (principal + alternos).
  const getSimpleTotalNet = (itemId: number, currentQuantity: number) =>
    getSimpleMainNet(itemId, currentQuantity) + getSimpleAlternoNet(itemId)

  // Actualiza las averías del lote principal (no puede exceder la cantidad).
  const updateSimpleMainAveria = (itemId: number, value: number, currentQuantity: number) => {
    setSimpleAverias((prev) => {
      const newMap = new Map(prev)
      newMap.set(itemId, Math.max(0, Math.min(currentQuantity, value || 0)))
      return newMap
    })
  }

  // Agrega una selección de lote alterno (toma la primera opción disponible
  // que no haya sido usada todavía para la línea).
  const addSimpleAlterno = (item: ExtendedPickingItem) => {
    const options = getAlternoOptionsForItem(item)
    const used = new Set(getSimpleAlternoSelections(item.id).map((s) => s.alternoId))
    const next = options.find((o) => !used.has(o.id))
    if (!next) {
      toast({
        title: "Sin lotes alternos",
        description: "No hay más lotes alternos disponibles para este producto",
        variant: "destructive",
      })
      return
    }
    setSimpleAlterno((prev) => {
      const newMap = new Map(prev)
      const list = [...(newMap.get(item.id) || [])]
      list.push({ alternoId: next.id, lote: next.lote, location: next.location, cantidad: 0, averias: 0 })
      newMap.set(item.id, list)
      return newMap
    })
  }

  // Elimina una selección de lote alterno.
  const removeSimpleAlterno = (itemId: number, alternoId: number) => {
    setSimpleAlterno((prev) => {
      const newMap = new Map(prev)
      newMap.set(itemId, (newMap.get(itemId) || []).filter((s) => s.alternoId !== alternoId))
      return newMap
    })
  }

  // Actualiza un campo (cantidad o averías) de una selección de lote alterno.
  const updateSimpleAlternoField = (
    itemId: number,
    alternoId: number,
    field: "cantidad" | "averias",
    value: number,
  ) => {
    setSimpleAlterno((prev) => {
      const newMap = new Map(prev)
      const list = (newMap.get(itemId) || []).map((s) => {
        if (s.alternoId !== alternoId) return s
        const updated = { ...s, [field]: Math.max(0, value || 0) }
        // Las averías no pueden exceder la cantidad de la estiba alterna.
        if (updated.averias > updated.cantidad) updated.averias = updated.cantidad
        return updated
      })
      newMap.set(itemId, list)
      return newMap
    })
  }

  const handleSimpleVerification = (itemId: number) => {
    setVerifiedItems((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const handleQuantityChange = (itemId: number, value: string) => {
    const newQuantity = Number.parseInt(value) || 0
    setEditedQuantities((prev) => {
      const newMap = new Map(prev)
      newMap.set(itemId, newQuantity)
      return newMap
    })
  }

  const handlePerformPicking = async (order: PendingLoadOrder) => {
    setSelectedOrder(order)
    setShowPickingView(true)

    setLoadingPicking(true)
    const result = await getPickingItems(order.ordendecargue, selectedEmpresaId ?? undefined)

    if (result.success) {
      // Initialize verificationType and reset QR states
      const initialPickingItems: ExtendedPickingItem[] = result.data.map((item) => ({
        ...item,
        verificationType: "simple", // Default to simple
        qrScans: [],
        qrAccumulatedQuantity: 0,
      }))
      setPickingItems(initialPickingItems)
      setAlternoItems((result as any).alternos || [])
      setVerifiedItems(new Set())
      setEditedQuantities(new Map())
      setQRPickingMode(new Map())
      setQRScannedPallets(new Map())
      setQRAccumulatedQuantities(new Map())
      setAlternoModeItems(new Set())
      setAlternoScannedPallets(new Map())
      setScanningAlterno(false)
      setSimpleAverias(new Map())
      setSimpleAlterno(new Map())
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setLoadingPicking(false)
  }

  const handleStartQRScan = (item: PickingItem) => {
    setCurrentScanningItem(item)
    setScanningItemId(item.id)
    setScanError(null)
    setScanSuccess(null)
    setIsCameraOpen(true)
  }

  const handleQRScanned = (scannedCode: string) => {
    if (!currentScanningItem) return

    const expectedLocation = currentScanningItem.location.trim()
    const trimmedCode = scannedCode.trim()

    setScannedLocations((prev) => {
      const newMap = new Map(prev)
      newMap.set(currentScanningItem.id, trimmedCode)
      return newMap
    })

    if (trimmedCode === expectedLocation) {
      setVerifiedItems((prev) => {
        const newSet = new Set(prev)
        newSet.add(currentScanningItem.id)
        return newSet
      })
      setScanSuccess(currentScanningItem.id)
      setScanError(null)

      toast({
        title: "Verificado",
        description: `Producto ${currentScanningItem.nombreproducto} verificado correctamente`,
      })

      setTimeout(() => {
        setScanningItemId(null)
        setScanSuccess(null)
        setCurrentScanningItem(null)
      }, 1500)
    } else {
      setScanError(`La ubicación leída no coincide con la ubicación esperada`)
      setScanSuccess(null)

      toast({
        title: "Error de verificación",
        description: `El código escaneado no coincide con la ubicación esperada`,
        variant: "destructive",
      })
    }

    setIsCameraOpen(false)
  }

  const handleCancelQRScan = () => {
    setIsCameraOpen(false)
    setScanningItemId(null)
    setScanError(null)
    setScanSuccess(null)
    setCurrentScanningItem(null)
  }

  const handleQRVerification = (itemId: number) => {
    setVerifiedItems((prev) => {
      const newSet = new Set(prev)
      newSet.add(itemId)
      return newSet
    })
    toast({
      title: "Verificación QR Confirmada",
      description: "La cantidad ha sido verificada exitosamente mediante escaneo de QR.",
    })
    setIsQRCameraOpen(false)
    setQRScanningForItem(null)
    setCurrentScanningItem(null)
  }

  // Confirma una verificación por QR con una cantidad MENOR a la del pedido.
  // Ajusta la cantidad mostrada de la línea al neto realmente escaneado, de
  // modo que la salida de invtrans (que el backend genera por estiba) refleje
  // la cantidad real despachada.
  const handlePartialQRVerification = (itemId: number, net: number) => {
    setEditedQuantities((prev) => {
      const newMap = new Map(prev)
      newMap.set(itemId, net)
      return newMap
    })
    handleQRVerification(itemId)
  }

  // Solicita la verificación SIMPLE: si el neto total es menor a la cantidad
  // del pedido, pide confirmación antes de verificar; si no, verifica directo.
  const requestSimpleVerification = (item: ExtendedPickingItem, currentQuantity: number) => {
    const required = item.cantidad
    const totalNet = getSimpleTotalNet(item.id, currentQuantity)
    if (totalNet < required) {
      setLowQtyConfirm({ itemId: item.id, net: totalNet, required, mode: "simple" })
      return
    }
    handleSimpleVerification(item.id)
  }

  // Solicita la verificación por QR con cantidad parcial: siempre pide
  // confirmación porque el neto es menor a la cantidad del pedido.
  const requestPartialQRVerification = (itemId: number, net: number, required: number) => {
    setLowQtyConfirm({ itemId, net, required, mode: "qr" })
  }

  // Ejecuta la verificación tras confirmar la cantidad menor en el diálogo.
  // Gerencia (2026-10-04): "faltante = enviar menos de lo que me piden"; si la línea no sale
  // completa debe haber una justificación. Este diálogo ya controlaba el despacho parcial, así
  // que el motivo se pide AQUÍ y no en otro sitio. Queda en las observaciones del movimiento.
  const confirmLowQtyVerification = () => {
    if (!lowQtyConfirm) return
    if (!justificacionValida(motivoFaltante)) return
    const { itemId, net, mode } = lowQtyConfirm
    setJustificaciones((prev) => {
      const m = new Map(prev)
      m.set(itemId, motivoFaltante.trim())
      return m
    })
    if (mode === "qr") {
      handlePartialQRVerification(itemId, net)
    } else {
      handleSimpleVerification(itemId)
    }
    setLowQtyConfirm(null)
    setMotivoFaltante("")
  }

  const handleConfirmPicking = async () => {
    if (!selectedOrder) return

    if (verifiedItems.size !== pickingItems.length) {
      toast({
        title: "Error",
        description: "Debe verificar todas las líneas antes de confirmar el picking",
        variant: "destructive",
      })
      return
    }

    setConfirmingPicking(true)

    const itemsToUpdate = pickingItems.map((item) => {
      const base = {
        id: item.id,
        cantidad: editedQuantities.get(item.id) ?? item.cantidad,
        // Motivo del saldo cuando la línea no sale completa. El servidor lo exige y lo
        // guarda en las observaciones del movimiento.
        justificacion: justificaciones.get(item.id)?.trim() || null,
      }

      // Si la línea se verificó por QR, enviamos los QR escaneados (estiba +
      // cantidad de salida + averías) y, si aplica, las estibas de lote
      // alterno (con su fila de origen alternoId) para que el backend divida
      // ambas líneas y registre las averías como entradas.
      const mode = modoDeItem(item)
      if (mode === "qr") {
        const scans = qrScannedPallets.get(item.id) || []
        const altScans = alternoScannedPallets.get(item.id) || []
        return {
          ...base,
          qrScans: scans.map((scan) => ({
            idqr: scan.idqr,
            cantidad: (scan as any).quantityTaken || scan.stock_total,
            averias: (scan as any).averias || 0,
          })),
          alternoScans: altScans.map((scan) => ({
            idqr: scan.idqr,
            cantidad: (scan as any).quantityTaken || scan.stock_total,
            averias: (scan as any).averias || 0,
            alternoId: (scan as any).alternoId,
          })),
        }
      }

      // Modo SIMPLE (sin QR): enviamos las averías del lote principal y las
      // selecciones de lote alterno para que el backend registre la entrada
      // por avería y apruebe las filas alternas correspondientes.
      const mainAverias = simpleAverias.get(item.id) || 0
      const alternoSel = simpleAlterno.get(item.id) || []
      return {
        ...base,
        averias: mainAverias,
        alternoSimple: alternoSel.map((s) => ({
          alternoId: s.alternoId,
          cantidad: s.cantidad,
          averias: s.averias || 0,
        })),
      }
    })

    const qrMovements: Array<{
      idqr: number
      codproducto: string
      nombreproducto: string
      lote: string
      cantidad: number
      location: string
    }> = []

    pickingItems.forEach((item) => {
      const mode = modoDeItem(item)
      if (mode === "qr") {
        const scans = [...(qrScannedPallets.get(item.id) || []), ...(alternoScannedPallets.get(item.id) || [])]
        scans.forEach((scan) => {
          qrMovements.push({
            idqr: scan.idqr,
            codproducto: scan.codproducto,
            nombreproducto: scan.nombreproducto,
            lote: scan.lote,
            cantidad: (scan as any).quantityTaken || scan.stock_total,
            location: scan.location,
          })
        })
      }
    })

    if (qrMovements.length > 0) {
      const qrResult = await registerQRPickingMovements(qrMovements)
      if (!qrResult.success) {
        toast({
          title: "Advertencia",
          description: "Error al registrar movimientos de QR, pero se continuará con el picking",
          variant: "destructive",
        })
      }
    }

    const result = await confirmPicking(selectedOrder.id, selectedOrder.ordendecargue, itemsToUpdate)

    if (result.success) {
      // Si la orden ya estaba verificada (confirmación repetida por intermitencia de red),
      // NO es un error: el trabajo ya quedó hecho. Se cierra igual para que el trabajador
      // no vuelva a intentar, que es lo que provocaba el doble despacho.
      toast({
        title: (result as { yaEstabaVerificada?: boolean }).yaEstabaVerificada ? "Ya estaba verificada" : "Éxito",
        description: result.message,
      })
      setShowPickingView(false)
      await loadOrders()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setConfirmingPicking(false)
  }

  const handleGeneratePDF = async (order: PendingLoadOrder) => {
    setGeneratingPDF(order.id)
    const result = await generatePickingPDF(order.id, order.ordendecargue, order.cliente, order.placa, order.conductor)

    if (result.success && result.url) {
      toast({
        title: "Éxito",
        description: result.message,
      })
      window.open(result.url, "_blank")
    } else {
      toast({
        title: "Error",
        description: result.error || result.message,
        variant: "destructive",
      })
    }
    setGeneratingPDF(null)
  }

  const handleUploadPhotos = (order: PendingLoadOrder) => {
    setSelectedPhotosOrder(order)
    setPhotoDialogOpen(true)
  }

  const handlePhotosUploaded = async () => {
    if (selectedPhotosOrder) {
      setOrdersWithPhotos((prev) => new Set([...prev, selectedPhotosOrder.id]))
    }
    await loadOrders()
  }

  // ─────────────── Despachar completo, y si queda saldo, con justificación ───────────────
  // Gerencia (2026-10-04): "se debe controlar que se despache la cantidad correcta: nunca
  // más, menos con explicación". La cantidad a despachar por lote viene automática de la
  // asignación de lotes (item.cantidad), y es contra ESA que se compara, no contra lo que se
  // escriba aquí. El QR usa el inventario identificado por estiba y el manual el que no lo
  // está: al final es un solo inventario, dividido por cómo está almacenado, así que la
  // comprobación es la misma en los dos modos.
  //
  // El BRUTO incluye lo que luego se reporta como avería: la avería ya queda documentada
  // como entrada aparte, así que no es un saldo sin explicar.
  // Se reutilizan las funciones que YA calculan el neto en cada modo, las mismas que usan
  // requestSimpleVerification y el área de QR: getNetForItem (escaneado normal + alterno,
  // menos averías) y getSimpleTotalNet (cantidad elegida + alterno, menos averías).
  const getDespachadoForItem = (item: ExtendedPickingItem) =>
    modoDeItem(item) === "qr"
      ? getNetForItem(item.id)
      : getSimpleTotalNet(item.id, editedQuantities.get(item.id) ?? item.cantidad)
  const redondea = (v: number) => Math.round(v * 100) / 100
  const getSaldoForItem = (item: ExtendedPickingItem) => redondea(Math.max(0, item.cantidad - getDespachadoForItem(item)))
  const getExcesoForItem = (item: ExtendedPickingItem) => redondea(Math.max(0, getDespachadoForItem(item) - item.cantidad))

  const lineasConSaldoSinMotivo = pickingItems.filter(
    (item) => getSaldoForItem(item) > 0.01 && !justificacionValida(justificaciones.get(item.id)),
  )
  const lineasExcedidas = pickingItems.filter((item) => getExcesoForItem(item) > 0.01)

  /**
   * Resumen del FALTANTE de una línea. SOLO LECTURA: el motivo se escribe en el diálogo de
   * "cantidad menor" que ya existía y que ya controla el despacho parcial, para no tener dos
   * sitios donde pedir lo mismo.
   */
  const renderJustificacion = (item: ExtendedPickingItem) => {
    const exceso = getExcesoForItem(item)
    if (exceso > 0.01) {
      return (
        <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-[11px] leading-tight text-red-800">
          <b>No se puede despachar más de lo asignado.</b> La asignación dejó {item.cantidad} y van {getDespachadoForItem(item)}.
          Quita {exceso} antes de confirmar.
        </div>
      )
    }
    const faltante = getSaldoForItem(item)
    if (faltante <= 0.01) return null
    const motivo = justificaciones.get(item.id) ?? ""
    const falta = !justificacionValida(motivo)
    return (
      <div className={`mt-2 rounded border p-2 ${falta ? "border-amber-400 bg-amber-50" : "border-green-300 bg-green-50"}`}>
        <p className="text-[11px] font-semibold leading-tight text-amber-900">
          Faltante de {faltante} de {item.cantidad}.
        </p>
        {falta ? (
          <p className="mt-0.5 text-[10px] leading-tight text-amber-800">
            Falta el motivo. Vuelve a tocar "Despachar cantidad parcial" para escribirlo.
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] leading-tight text-green-800">Motivo: {motivo}</p>
        )}
      </div>
    )
  }

  const allItemsVerified = pickingItems.length > 0 && verifiedItems.size === pickingItems.length
  /** Se puede confirmar cuando todo está verificado, nada excede y los saldos tienen motivo. */
  const puedeConfirmar = allItemsVerified && lineasExcedidas.length === 0 && lineasConSaldoSinMotivo.length === 0

  // Tarjetas de estibas escaneadas con input de averías (normal o alterno).
  const renderScanCards = (itemId: number, scans: QRPalletInfo[], isAlterno: boolean) =>
    scans.map((scan) => {
      const qty = (scan as any).quantityTaken ?? scan.stock_total
      const averias = (scan as any).averias || 0
      return (
        <div
          key={`${isAlterno ? "alt" : "norm"}-${scan.idqr}`}
          className={`p-2 rounded border text-xs ${isAlterno ? "bg-amber-50 border-amber-200" : "bg-white border-blue-100"}`}
        >
          <div className="font-medium text-gray-900">QR: {scan.idqr}</div>
          <div className="text-gray-600">Cantidad: {qty}</div>
          <div className="text-gray-600">Ubicación: {scan.location}</div>
          <div className="text-gray-600">Lote: {scan.lote}</div>
          <div className="flex items-center gap-2 mt-1.5">
            <Label className="text-xs whitespace-nowrap">Averías:</Label>
            <Input
              type="number"
              min="0"
              max={qty}
              value={averias}
              onChange={(e) => updateScanAveria(itemId, scan.idqr, Number.parseInt(e.target.value) || 0, isAlterno)}
              className="h-7 w-20"
            />
            <span className="text-gray-500">Neto: {qty - averias}</span>
          </div>
        </div>
      )
    })

  // Área de verificación por QR (en progreso o ya verificada).
  const renderQRArea = (item: ExtendedPickingItem, currentQuantity: number, isVerified: boolean) => {
    const itemId = item.id
    const normalScans = qrScannedPallets.get(itemId) || []
    const altScans = alternoScannedPallets.get(itemId) || []
    const net = getNetForItem(itemId)
    const averias = getAveriasForItem(itemId)
    const falta = Math.max(0, currentQuantity - net)
    const alternoOptions = getAlternoOptionsForItem(item)
    const alternoActive = alternoModeItems.has(itemId)

    if (isVerified) {
      return (
        <Accordion type="single" collapsible className="w-full" defaultValue="pallets">
          <AccordionItem value="pallets" className="border rounded-lg">
            <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline bg-green-50 rounded">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span className="font-semibold text-green-700">
                  {normalScans.length + altScans.length} estiba
                  {normalScans.length + altScans.length !== 1 ? "s" : ""} · Neto {net}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pt-2">
              <div className="space-y-1.5">
                <div className="font-semibold text-xs text-blue-900">
                  Total salida: {net + averias} · Averías: {averias} · Neto: {net}
                </div>
                {normalScans.length > 0 && renderScanCards(itemId, normalScans, false)}
                {altScans.length > 0 && (
                  <>
                    <div className="font-medium text-amber-800 mt-1">Lote alterno:</div>
                    {renderScanCards(itemId, altScans, true)}
                  </>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )
    }

    return (
      <div className="mt-2 space-y-2">
        {(normalScans.length > 0 || altScans.length > 0) && (
          <div className="text-xs space-y-2 p-3 bg-blue-50 rounded border border-blue-200">
            <div className="font-semibold text-sm text-blue-900">
              Neto: {net} / {currentQuantity}
            </div>
            {averias > 0 && <div className="text-amber-700 font-medium">Averías totales: {averias}</div>}
            {normalScans.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-medium text-blue-800">Estibas escaneadas:</div>
                {renderScanCards(itemId, normalScans, false)}
              </div>
            )}
            {altScans.length > 0 && (
              <div className="space-y-1.5">
                <div className="font-medium text-amber-800">Estibas lote alterno:</div>
                {renderScanCards(itemId, altScans, true)}
              </div>
            )}
          </div>
        )}

        <Button variant="outline" size="sm" onClick={() => handleStartQRScanning(item)} className="w-full">
          <Camera className="h-4 w-4 mr-1" />
          {normalScans.length > 0 ? "Escanear más QR" : "Escanear QR"}
        </Button>

        {/* Lote alterno: solo cuando falta inventario tras reportar averías */}
        {falta > 0 && (normalScans.length > 0 || altScans.length > 0) && (
          <div className="text-xs p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
            <div className="flex items-center gap-2 text-amber-800 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Faltan {falta} unidades
            </div>
            {alternoOptions.length > 0 ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleStartAlternoScanning(item)}
                  className="w-full border-amber-400 text-amber-800 hover:bg-amber-100"
                >
                  <Camera className="h-4 w-4 mr-1" />
                  {alternoActive ? "Escanear QR lote alterno" : "Cargar lote alterno"}
                </Button>
                <div className="text-amber-700">
                  Lotes alternos disponibles: {alternoOptions.map((a) => a.lote).join(", ")}
                </div>
              </>
            ) : (
              <div className="text-red-600">No hay lote alterno disponible para este producto.</div>
            )}
          </div>
        )}

        {net >= currentQuantity && (normalScans.length > 0 || altScans.length > 0) && (
          <Button
            variant="default"
            size="sm"
            onClick={() => handleQRVerification(itemId)}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            <Check className="h-4 w-4 mr-1" />
            Confirmar Verificación
          </Button>
        )}

        {/* Despacho parcial: permite confirmar con menos de lo pedido. La
            salida de invtrans quedará con el neto realmente escaneado. */}
        {net > 0 && net < currentQuantity && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => requestPartialQRVerification(itemId, net, currentQuantity)}
            className="w-full border-amber-400 text-amber-800 hover:bg-amber-100"
          >
            <Check className="h-4 w-4 mr-1" />
            Despachar cantidad parcial ({net})
          </Button>
        )}
      </div>
    )
  }

  // Área de verificación SIMPLE (sin QR): averías del lote principal + lote
  // alterno cuando el neto no alcanza la cantidad requerida de la orden.
  const renderSimpleArea = (item: ExtendedPickingItem, currentQuantity: number) => {
    const itemId = item.id
    const required = item.cantidad
    const mainAverias = getSimpleMainAverias(itemId)
    const mainNet = getSimpleMainNet(itemId, currentQuantity)
    const totalNet = getSimpleTotalNet(itemId, currentQuantity)
    const shortfall = Math.max(0, required - totalNet)
    const selections = getSimpleAlternoSelections(itemId)
    const alternoOptions = getAlternoOptionsForItem(item)
    const showAlterno = mainNet < required

    return (
      <div className="space-y-2">
        {/* Averías del lote principal */}
        <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded">
          <Label className="text-xs whitespace-nowrap flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            Averías:
          </Label>
          <Input
            type="number"
            min="0"
            max={currentQuantity}
            value={mainAverias}
            onChange={(e) => updateSimpleMainAveria(itemId, Number.parseInt(e.target.value) || 0, currentQuantity)}
            className="h-8 w-20"
          />
          <span className="text-xs text-gray-600">
            Neto: {mainNet} / {required}
          </span>
        </div>

        {/* Lote alterno cuando el lote principal no alcanza */}
        {showAlterno && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded space-y-2">
            <div className="flex items-center gap-2 text-amber-800 font-semibold text-xs">
              <AlertTriangle className="h-4 w-4" />
              {shortfall > 0 ? `Faltan ${shortfall} unidades` : "Faltante cubierto con lote alterno"}
            </div>

            {selections.map((sel) => (
              <div key={sel.alternoId} className="p-2 rounded border bg-white border-amber-200 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    Lote alterno: {sel.lote} · {sel.location}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-red-600 hover:text-red-700"
                    onClick={() => removeSimpleAlterno(itemId, sel.alternoId)}
                  >
                    Quitar
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="whitespace-nowrap">Cantidad:</Label>
                  <Input
                    type="number"
                    min="0"
                    value={sel.cantidad}
                    onChange={(e) =>
                      updateSimpleAlternoField(itemId, sel.alternoId, "cantidad", Number.parseInt(e.target.value) || 0)
                    }
                    className="h-7 w-20"
                  />
                  <Label className="whitespace-nowrap">Averías:</Label>
                  <Input
                    type="number"
                    min="0"
                    max={sel.cantidad}
                    value={sel.averias}
                    onChange={(e) =>
                      updateSimpleAlternoField(itemId, sel.alternoId, "averias", Number.parseInt(e.target.value) || 0)
                    }
                    className="h-7 w-20"
                  />
                  <span className="text-gray-500">Neto: {sel.cantidad - sel.averias}</span>
                </div>
              </div>
            ))}

            {alternoOptions.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => addSimpleAlterno(item)}
                className="w-full border-amber-400 text-amber-800 hover:bg-amber-100"
              >
                Agregar lote alterno
              </Button>
            ) : (
              <div className="text-xs text-red-600">No hay lote alterno disponible para este producto.</div>
            )}

            <div className="text-xs font-medium text-amber-900">
              Neto total: {totalNet} / {required}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => requestSimpleVerification(item, currentQuantity)}
          className="w-full"
        >
          <Check className="h-4 w-4 mr-1" />
          Verificar
        </Button>
      </div>
    )
  }

  // Resumen de la verificación SIMPLE ya confirmada (con averías/alterno).
  const renderSimpleVerified = (item: ExtendedPickingItem, currentQuantity: number) => {
    const itemId = item.id
    const mainAverias = getSimpleMainAverias(itemId)
    const totalNet = getSimpleTotalNet(itemId, currentQuantity)
    const selections = getSimpleAlternoSelections(itemId)
    const hasExtras = mainAverias > 0 || selections.length > 0

    return (
      <div className="space-y-1">
        <div className="flex items-center justify-center gap-2 text-green-600">
          <Check className="h-5 w-5" />
          <span className="font-semibold">Verificado</span>
        </div>
        {hasExtras && (
          <div className="text-xs text-center text-gray-600">
            Neto: {totalNet}
            {mainAverias > 0 && ` · Averías: ${mainAverias}`}
            {selections.length > 0 && ` · ${selections.length} lote(s) alterno`}
          </div>
        )}
      </div>
    )
  }

  if (showPickingView) {
    return (
      <div className="space-y-4 pb-8">
        {/* Header with back button */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-4">
              {/* No se puede salir de la verificación por aquí: la única
                  forma de cerrar esta pantalla es completar todas las
                  líneas y presionar "Confirmar Picking" — evita dejar la
                  orden a medio verificar sin darse cuenta. */}
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Debes verificar todas las líneas y presionar Confirmar Picking para salir"
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Volver
              </Button>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-primary" />
                Verificación de Picking - {selectedOrder?.ordendecargue}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div>Cliente: {selectedOrder?.cliente}</div>
              <div>Placa: {selectedOrder?.placa}</div>
              <div className="ml-auto font-semibold">
                Verificados: {verifiedItems.size} / {pickingItems.length}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Picking content */}
        <Card>
          <CardContent className="p-2 md:p-4">
            {loadingPicking ? (
              <div className="text-center py-8 text-muted-foreground">Cargando productos...</div>
            ) : pickingItems.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No hay productos para picking</div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block rounded-md border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted">
                        <th className="p-3 text-left font-medium">Producto</th>
                        <th className="p-3 text-left font-medium">Lote</th>
                        <th className="p-3 text-left font-medium">Ubicación</th>
                        <th className="p-3 text-left font-medium">Cantidad</th>
                        <th className="p-3 text-center font-medium">Stock Disp.</th>
                        <th className="p-3 text-center font-medium">Stock Rest.</th>
                        <th className="p-3 text-left font-medium">Verificación</th>
                        <th className="p-3 text-center font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pickingItems.map((item) => {
                        const currentQuantity = editedQuantities.get(item.id) ?? item.cantidad
                        const isVerified = verifiedItems.has(item.id)
                        const stockRestante = (item.stock_disp || 0) - currentQuantity
                        const verificationMode = modoDeItem(item)
                        const qrScans = qrScannedPallets.get(item.id) || []
                        const qrAccumulated = qrAccumulatedQuantities.get(item.id) || 0

                        return (
                          <tr key={item.id} className={`border-b ${isVerified ? "bg-green-50" : ""}`}>
                            <td className="p-3">{item.nombreproducto}</td>
                            <td className="p-3">{item.lote}</td>
                            <td className="p-3 font-mono font-semibold">{item.location}</td>
                            <td className="p-3">
                              <Input
                                type="number"
                                min="0"
                                value={currentQuantity}
                                onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                                className="w-24"
                                disabled={verificationMode === "qr" || isVerified}
                              />
                            </td>
                            <td className="p-3 text-center">
                              <span className="font-semibold">{item.stock_disp || 0}</span>
                            </td>
                            <td className="p-3 text-center">
                              <span
                                className={`font-semibold ${stockRestante < 0 ? "text-red-600" : "text-green-600"}`}
                              >
                                {stockRestante}
                              </span>
                            </td>
                            <td className="p-3">
                              {isVerified && verificationMode === "qr" ? (
                                renderQRArea(item as any, currentQuantity, true)
                              ) : isVerified && verificationMode === "simple" ? (
                                renderSimpleVerified(item as any, currentQuantity)
                              ) : (
                                <>
                                  {/* "Sin QR" queda habilitado aunque el stock
                                      viva en estibas: el aviso informa del
                                      descuadre, pero no impide el picking. */}
                                  <RadioGroup
                                    value={verificationMode}
                                    onValueChange={(value) =>
                                      handleVerificationModeChange(item.id, value as "simple" | "qr")
                                    }
                                    disabled={isVerified}
                                  >
                                    <div className="flex items-center space-x-2 mb-2">
                                      <RadioGroupItem value="simple" id={`simple-${item.id}`} />
                                      <Label htmlFor={`simple-${item.id}`} className="text-xs cursor-pointer">
                                        Sin QR
                                      </Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <RadioGroupItem value="qr" id={`qr-${item.id}`} />
                                      <Label htmlFor={`qr-${item.id}`} className="text-xs cursor-pointer">
                                        Con QR
                                      </Label>
                                    </div>
                                  </RadioGroup>

                                  {item.tieneStockQR && verificationMode === "simple" && (
                                    <p className="mb-2 text-[10px] leading-tight text-amber-700">
                                      Este inventario está en estibas con QR. Si lo descuentas sin
                                      escanear, la estiba conservará ese stock.
                                    </p>
                                  )}

                                  {verificationMode === "simple" && !isVerified &&
                                    renderSimpleArea(item as any, currentQuantity)}

                                  {verificationMode === "qr" && !isVerified &&
                                    renderQRArea(item as any, currentQuantity, false)}
                                </>
                              )}
                              {/* El saldo y su motivo se ven igual antes y después de
                                  verificar: si desaparecieran al verificar, el botón
                                  quedaría bloqueado sin que se vea por qué. */}
                              {renderJustificacion(item)}
                            </td>
                            <td className="p-3 text-center">
                              {isVerified ? (
                                <div className="flex items-center justify-center gap-1 text-green-600">
                                  <Check className="h-5 w-5" />
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">Pendiente</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="md:hidden space-y-3">
                  {pickingItems.map((item) => {
                    const currentQuantity = editedQuantities.get(item.id) ?? item.cantidad
                    const isVerified = verifiedItems.has(item.id)
                    const stockRestante = (item.stock_disp || 0) - currentQuantity
                    const verificationMode = modoDeItem(item)
                    const qrScans = qrScannedPallets.get(item.id) || []
                    const qrAccumulated = qrAccumulatedQuantities.get(item.id) || 0

                    return (
                      <Card key={item.id} className={`p-3 ${isVerified ? "bg-green-50 border-green-200" : ""}`}>
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Producto</div>
                            <div className="font-semibold text-sm">{item.nombreproducto}</div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Lote</div>
                              <div className="font-medium text-sm">{item.lote}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Ubicación</div>
                              <div className="font-mono font-bold text-lg text-blue-600">{item.location}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2 p-2 bg-muted/30 rounded">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Cantidad</div>
                              <Input
                                type="number"
                                min="0"
                                value={currentQuantity}
                                onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                                className="h-9 text-center font-semibold"
                                disabled={verificationMode === "qr"}
                              />
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Stock Disp.</div>
                              <div className="h-9 flex items-center justify-center font-semibold text-sm border rounded">
                                {item.stock_disp || 0}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Stock Rest.</div>
                              <div
                                className={`h-9 flex items-center justify-center font-semibold text-sm border rounded ${stockRestante < 0 ? "text-red-600 border-red-300 bg-red-50" : "text-green-600 border-green-300 bg-green-50"}`}
                              >
                                {stockRestante}
                              </div>
                            </div>
                          </div>

                          <div className="pt-2 border-t space-y-2">
                            {isVerified && verificationMode === "qr" ? (
                              renderQRArea(item as any, currentQuantity, true)
                            ) : isVerified && verificationMode === "simple" ? (
                              renderSimpleVerified(item as any, currentQuantity)
                            ) : (
                              <>
                                <div className="text-xs font-medium text-muted-foreground">Tipo de Verificación</div>
                                {item.tieneStockQR && verificationMode === "simple" && (
                                  <p className="text-[11px] leading-tight text-amber-700">
                                    Este inventario está en estibas con QR. Si lo descuentas sin escanear,
                                    la estiba conservará ese stock.
                                  </p>
                                )}
                                <RadioGroup
                                  value={verificationMode}
                                  onValueChange={(value) =>
                                    handleVerificationModeChange(item.id, value as "simple" | "qr")
                                  }
                                  disabled={isVerified}
                                >
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="simple" id={`simple-m-${item.id}`} />
                                    <Label htmlFor={`simple-m-${item.id}`} className="text-sm cursor-pointer">
                                      Sin QR
                                    </Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="qr" id={`qr-m-${item.id}`} />
                                    <Label htmlFor={`qr-m-${item.id}`} className="text-sm cursor-pointer">
                                      Con QR
                                    </Label>
                                  </div>
                                </RadioGroup>
                              </>
                            )}
                          </div>

                          {!isVerified && (
                            <div className="pt-2 border-t">
                              {verificationMode === "simple"
                                ? renderSimpleArea(item as any, currentQuantity)
                                : renderQRArea(item as any, currentQuantity, false)}
                            </div>
                          )}
                          {renderJustificacion(item)}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Confirm button */}
        <div className="flex flex-col items-end gap-2">
          {lineasExcedidas.length > 0 && (
            <p className="text-xs font-semibold text-red-700">
              {lineasExcedidas.length === 1 ? "Una línea lleva" : `${lineasExcedidas.length} líneas llevan`} más de lo asignado. No se puede despachar de más.
            </p>
          )}
          {lineasExcedidas.length === 0 && lineasConSaldoSinMotivo.length > 0 && (
            <p className="text-xs font-semibold text-amber-800">
              {lineasConSaldoSinMotivo.length === 1 ? "Falta el motivo de un saldo" : `Faltan los motivos de ${lineasConSaldoSinMotivo.length} saldos`}. El despacho debe ir completo; si no va completo, escribe por qué.
            </p>
          )}
          <Button onClick={handleConfirmPicking} disabled={!puedeConfirmar || confirmingPicking} size="lg">
            {confirmingPicking ? "Confirmando..." : "Confirmar Picking"}
          </Button>
        </div>

        {/* QR Scanner Dialog */}
        {isQRCameraOpen && (
          <>
            <Dialog
              open={isQRCameraOpen}
              onOpenChange={(open) => {
                if (!open) {
                  setIsQRCameraOpen(false)
                  setManualQR("")
                }
              }}
            >
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Escanear QR de Estiba</DialogTitle>
                  <DialogDescription asChild>
                    {currentScanningItem ? (
                      <div className="space-y-1">
                        <div>Producto: {currentScanningItem.nombreproducto}</div>
                        <div>Lote: {currentScanningItem.lote}</div>
                        <div>
                          Acumulado: {qrAccumulatedQuantities.get(currentScanningItem.id) || 0} /{" "}
                          {editedQuantities.get(currentScanningItem.id) ?? currentScanningItem.cantidad}
                        </div>
                      </div>
                    ) : (
                      <span>Ingrese o escanee el número de QR de la estiba.</span>
                    )}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  {/* Entrada manual del número de QR */}
                  <div className="space-y-2">
                    <Label htmlFor="manual-qr">Número de QR de estiba</Label>
                    <div className="flex gap-2">
                      <Input
                        id="manual-qr"
                        autoFocus
                        placeholder="Ej: 12345"
                        value={manualQR}
                        onChange={(e) => setManualQR(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleManualQRSubmit()
                          }
                        }}
                      />
                      <Button onClick={handleManualQRSubmit} disabled={!manualQR.trim()}>
                        Buscar
                      </Button>
                    </div>
                  </div>

                  {/* Separador y opción de cámara */}
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">o</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full gap-2 bg-transparent"
                    onClick={() => setIsCameraScannerOpen(true)}
                  >
                    <Camera className="h-4 w-4" />
                    Escanear con cámara
                  </Button>

                  {scanError && (
                    <Alert variant="destructive">
                      <AlertDescription>{scanError}</AlertDescription>
                    </Alert>
                  )}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsQRCameraOpen(false)
                      setManualQR("")
                    }}
                  >
                    Cancelar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <QRCameraScanner
              isOpen={isCameraScannerOpen}
              onClose={() => setIsCameraScannerOpen(false)}
              onScan={(code) => {
                setIsCameraScannerOpen(false)
                handleQRPickingScanned(code)
              }}
            />
          </>
        )}

        {/* Confirmación al verificar una cantidad menor a la del pedido */}
        <Dialog open={lowQtyConfirm !== null} onOpenChange={(open) => !open && setLowQtyConfirm(null)}>
          <DialogContent className="max-w-md w-[95vw]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Cantidad menor a la del pedido
              </DialogTitle>
              <DialogDescription className="text-sm">
                {lowQtyConfirm && (
                  <>
                    Está verificando con <span className="font-semibold">{lowQtyConfirm.net}</span> unidades, una
                    cantidad menor a la solicitada en el pedido (
                    <span className="font-semibold">{lowQtyConfirm.required}</span>). La salida se registrará con la
                    cantidad real verificada.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            {/* El faltante es válido pero nunca silencioso: el motivo queda guardado en el
                movimiento de inventario y se ve en el ciclo de la orden. */}
            <div className="space-y-1">
              <Label htmlFor="motivo-faltante" className="text-xs font-semibold">
                Motivo del faltante{lowQtyConfirm ? ` de ${Math.round((lowQtyConfirm.required - lowQtyConfirm.net) * 100) / 100} unidades` : ""}
              </Label>
              <Input
                id="motivo-faltante"
                value={motivoFaltante}
                onChange={(e) => setMotivoFaltante(e.target.value)}
                placeholder="Por qué se envía menos de lo que piden"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">Obligatorio, al menos {JUSTIFICACION_MINIMA} letras.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setLowQtyConfirm(null); setMotivoFaltante("") }}>
                Cancelar
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700"
                onClick={confirmLowQtyVerification}
                disabled={!justificacionValida(motivoFaltante)}
              >
                <Check className="h-4 w-4 mr-1" />
                Sí, verificar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-8">
      <Card className="hidden md:block">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Ordenes de Cargue Pendientes
          </CardTitle>
          <Button onClick={loadOrders} disabled={loading} size="sm" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refrescar
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Orden</th>
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Fecha Orden</th>
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Fecha Cargue</th>
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Cliente</th>
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Placa</th>
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Conductor</th>
                  <th className="py-2 px-2 text-center text-[10px] font-medium">Facturar</th>
                  <th className="py-2 px-2 text-left text-[10px] font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center p-8 text-muted-foreground text-xs">
                      Cargando órdenes...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center p-8 text-muted-foreground text-xs">
                      No hay órdenes de cargue pendientes.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-muted/50">
                      <td className="py-1 px-2 text-[10px]">{order.ordendecargue}</td>
                      <td className="py-1 px-2 text-[10px]">
                        {order.fechaorden ? new Date(order.fechaorden + "T12:00:00").toLocaleDateString("es-CO") : "-"}
                      </td>
                      <td className="py-1 px-2 text-[10px]">
                        {order.fechacargue
                          ? new Date(order.fechacargue + "T12:00:00").toLocaleDateString("es-CO")
                          : "-"}
                      </td>
                      <td className="py-1 px-2 text-[10px]">{order.cliente}</td>
                      <td className="py-1 px-2 text-[10px]">{order.placa}</td>
                      <td className="py-1 px-2 text-[10px]">{order.conductor}</td>
                      <td className="py-1 px-2 text-center">
                        {/* Facturar el cargue. Encendido por defecto; al desmarcar pide
                            confirmación + motivo y registra el cambio. */}
                        <FacturarCheckbox
                          orden={{ ...order, tipooperacion: "Cargue" }}
                          facturar={order.facturar}
                          idempresa={selectedEmpresaId}
                          usuario={profile?.usuario}
                          modulo="Picking"
                          disabled={!!order.fincargue}
                          onChanged={(v) =>
                            setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, facturar: v } : o)))
                          }
                        />
                      </td>
                      <td className="py-1 px-2">
                        {/* Picking es una actividad de bodega: se hace ANTES de
                            que llegue el vehículo, apenas hay lote asignado — no
                            depende de a qué muelle se asigne después. Asignar
                            Personal se movió por completo a Centro de
                            Coordinación (decisión del coordinador, junto con
                            muelle y tipo de pago); aquí solo queda Picking, PDF
                            y Cargar fotos (que exige que ya haya personal y tipo
                            de pago elegidos allá).
                              - PDF requiere haber realizado el picking (no
                                bloqueamos por `iniciocargue` porque el PDF lo
                                escribe; solo evitamos doble generacion). Si ya
                                existe (por ejemplo, generado al asignar muelle
                                en Centro de Coordinación), no se regenera — solo
                                se abre, sin restricción para el montacarguista.
                              - Cargar fotos requiere `auxiliares` y `tipo_pago`
                                (asignados en Centro de Coordinación). El cargue
                                de fotos cierra la orden (escribe `fincargue`),
                                por eso es el paso final.
                        */}
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handlePerformPicking(order)}
                            disabled={!!order.horapicking} // Picking ya realizado
                            className="gap-1 h-7 text-[10px] px-2"
                          >
                            <CheckSquare className="h-3 w-3" />
                            Realizar picking
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleGeneratePDF(order)}
                            disabled={generatingPDF === order.id}
                            className="gap-1 h-7 text-[10px] px-2"
                          >
                            <FileText className="h-3 w-3" />
                            {generatingPDF === order.id ? "Generando..." : order.doccargue ? "Ver PDF" : "Generar PDF"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleUploadPhotos(order)}
                            disabled={!order.auxiliares || !order.tipo_pago || pausedOrders.has(order.ordendecargue)}
                            title={pausedOrders.has(order.ordendecargue) ? "Reanuda el cargue antes de cerrar" : undefined}
                            className="h-7 text-[10px] px-2"
                          >
                            <Camera className="h-3 w-3 mr-1" />
                            Cargar fotos
                          </Button>
                          {/* Pausar/Reanudar el cargue. Solo disponible cuando la
                              orden ya tiene iniciocargue. */}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTogglePausa(order)}
                            disabled={!order.iniciocargue || pausingOrder === order.ordendecargue}
                            className="gap-1 h-7 text-[10px] px-2"
                          >
                            {pausedOrders.has(order.ordendecargue) ? (
                              <>
                                <Play className="h-3 w-3" />
                                Reanudar
                              </>
                            ) : (
                              <>
                                <Pause className="h-3 w-3" />
                                Pausar
                              </>
                            )}
                          </Button>
                        </div>
                        {/* Personal y tipo de pago los asigna el coordinador en
                            Centro de Coordinación, no aquí — Picking solo avisa
                            si falta alguno, sin poder cambiarlo. */}
                        {!order.iniciocargue ? null : !order.auxiliares ? (
                          <div className="mt-1 text-[10px] font-medium text-rose-600">
                            ⚠ Falta asignar personal en Centro de Coordinación
                          </div>
                        ) : !order.tipo_pago ? (
                          <div className="mt-1 text-[10px] font-medium text-rose-600">
                            ⚠ Falta elegir tipo de pago en Centro de Coordinación
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="md:hidden space-y-4">
        <div className="flex items-center justify-between p-4 bg-card rounded-lg border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Picking
          </h2>
          <Button onClick={loadOrders} disabled={loading} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loading ? (
          <div className="text-center p-8 text-muted-foreground">Cargando órdenes...</div>
        ) : orders.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground">No hay órdenes pendientes.</div>
        ) : (
          orders.map((order) => (
            <Card key={order.id} className="p-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-primary">{order.ordendecargue}</span>
                  <span className="text-xs text-muted-foreground">{order.placa}</span>
                </div>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliente:</span>
                    <span className="font-medium text-right">{order.cliente}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Conductor:</span>
                    <span className="font-medium">{order.conductor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fecha Orden:</span>
                    <span className="font-medium">
                      {order.fechaorden ? new Date(order.fechaorden + "T12:00:00").toLocaleDateString("es-CO") : "-"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fecha Cargue:</span>
                    <span className="font-medium">
                      {order.fechacargue ? new Date(order.fechacargue + "T12:00:00").toLocaleDateString("es-CO") : "-"}
                    </span>
                  </div>
                </div>
                {/* Mismo flujo en mobile: Picking -> PDF -> Personal -> Fotos */}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => handlePerformPicking(order)}
                    disabled={!!order.horapicking}
                    className="text-xs h-9"
                  >
                    <CheckSquare className="h-3 w-3 mr-1" />
                    Picking
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleGeneratePDF(order)}
                    disabled={generatingPDF === order.id}
                    className="text-xs h-9"
                  >
                    <FileText className="h-3 w-3 mr-1" />
                    {order.doccargue ? "Ver PDF" : "PDF"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleUploadPhotos(order)}
                    disabled={!order.auxiliares || !order.tipo_pago}
                    className="text-xs h-9"
                  >
                    <Camera className="h-3 w-3 mr-1" />
                    Fotos
                  </Button>
                  {/* Pausar/Reanudar el cargue. Ocupa todo el ancho debajo. */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleTogglePausa(order)}
                    disabled={!order.iniciocargue || pausingOrder === order.ordendecargue}
                    className="text-xs h-9 col-span-2"
                  >
                    {pausedOrders.has(order.ordendecargue) ? (
                      <>
                        <Play className="h-3 w-3 mr-1" />
                        Reanudar
                      </>
                    ) : (
                      <>
                        <Pause className="h-3 w-3 mr-1" />
                        Pausar
                      </>
                    )}
                  </Button>
                </div>
                {order.iniciocargue && !order.auxiliares ? (
                  <div className="mt-1 text-[10px] font-medium text-rose-600">
                    ⚠ Falta asignar personal en Centro de Coordinación
                  </div>
                ) : order.iniciocargue && !order.tipo_pago ? (
                  <div className="mt-1 text-[10px] font-medium text-rose-600">
                    ⚠ Falta elegir tipo de pago en Centro de Coordinación
                  </div>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </div>


      {selectedPhotosOrder && (
        <PickingPhotoUploadDialog
          open={photoDialogOpen}
          onOpenChange={setPhotoDialogOpen}
          orderId={selectedPhotosOrder.id}
          orderLabel={selectedPhotosOrder.ordendecargue}
          onUploaded={handlePhotosUploaded}
        />
      )}

      {/* Confirmación al verificar una cantidad menor a la del pedido */}
      <Dialog open={lowQtyConfirm !== null} onOpenChange={(open) => !open && setLowQtyConfirm(null)}>
        <DialogContent className="max-w-md w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Cantidad menor a la del pedido
            </DialogTitle>
            <DialogDescription className="text-sm">
              {lowQtyConfirm && (
                <>
                  Está verificando con <span className="font-semibold">{lowQtyConfirm.net}</span> unidades, una cantidad
                  menor a la solicitada en el pedido (<span className="font-semibold">{lowQtyConfirm.required}</span>). La
                  salida se registrará con la cantidad real verificada.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="motivo-faltante-2" className="text-xs font-semibold">
              Motivo del faltante{lowQtyConfirm ? ` de ${Math.round((lowQtyConfirm.required - lowQtyConfirm.net) * 100) / 100} unidades` : ""}
            </Label>
            <Input
              id="motivo-faltante-2"
              value={motivoFaltante}
              onChange={(e) => setMotivoFaltante(e.target.value)}
              placeholder="Por qué se envía menos de lo que piden"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground">Obligatorio, al menos {JUSTIFICACION_MINIMA} letras.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setLowQtyConfirm(null); setMotivoFaltante("") }}>
              Cancelar
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={confirmLowQtyVerification}
              disabled={!justificacionValida(motivoFaltante)}
            >
              <Check className="h-4 w-4 mr-1" />
              Sí, verificar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { Picking }
