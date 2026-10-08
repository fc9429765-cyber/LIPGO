"use client"

import type React from "react"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RefreshCw, FileText, UserPlus, ArrowLeft, Camera, Check, Pause, Play } from "lucide-react"
import {
  getPendingUnloadOrders,
  getDistributionOrders,
  type PendingLoadOrder,
  generatePackingPDF,
  getCarguDescarguePersonnel,
  type PersonnelEmployee,
  assignPersonnelToOrder,
  getPackingItems,
  type PackingItem,
  confirmPacking,
} from "@/lib/packing-actions"
// Las pausas viven en `lib/picking-actions` porque nacieron ahi, pero NO son
// propias del picking: son pausas de una ORDEN, sobre la tabla `pausas`.
//
// Reutilizarlas aqui no cruza datos entre los dos modulos: picking solo lista
// ordenes de `tipooperacion = 'Cargue'` y packing lista Descargue y
// Distribucion, asi que un mismo `ordendecargue` nunca aparece en ambos.
import { pausarOrden, reanudarOrden, getOrdenesPausadas } from "@/lib/picking-actions"
import { FacturarCheckbox } from "@/components/facturar-checkbox"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useIsMobile } from "@/components/qr-camera-scanner"
import { useAuth } from "@/components/auth-provider"

// Caso especial: orden de DISTRIBUCIÓN marcada "no facturar" (facturar = false).
// Si no se factura es porque NO se envió gente → la orden no lleva auxiliares: se
// bloquea "Asignar Personal" y se permite cerrar por "Cargar Fotos" sin personal.
// Aplica a CUALQUIER distribución no facturable, sin importar el formato del número
// (clones "…D" o "Dis-…"): lo que manda es la funcionalidad, no el sufijo. Solo toca
// distribución; los descargues del Packing siguen exigiendo su personal normal.
function esDistribucionNoFacturable(o: PendingLoadOrder): boolean {
  return o.tipooperacion === "Distribucion" && o.facturar === false
}

// Clon de Distribución automática ("+D", ver generarDistribucionAutomatica en
// lib/orders-actions.tsx): es el MISMO vehículo/orden que su madre de Cargue,
// ya excluida de Centro de Coordinación (único lugar donde se elige tipo de
// pago) — no tiene forma de que le asignen el suyo propio. La ruta de cierre
// (app/api/upload-picking-photos/route.ts) hereda el tipo de pago de la madre
// automáticamente, así que acá no se exige: bloquear el botón esperando un
// tipo_pago que el clon nunca va a tener dejaba la orden trabada sin poder
// cerrarse en Packing.
function esClonDistribucion(o: PendingLoadOrder): boolean {
  return o.tipooperacion === "Distribucion" && String(o.ordendecargue || "").endsWith("D")
}

// Descargue de Huevos en ID2: ese personal se paga aparte (puesto "Cargue/
// Descargue Huevos"), no por destajo de esta orden — se puede cerrar sin
// personal asignado ni tipo de pago elegido. Confirmado 2026-08-28, alcance
// estricto: solo Descargue + Huevos + ID2 (`esDescargueHuevos` ya viene
// calculado así desde getPendingUnloadOrders); el resto de descargues sigue
// exigiendo personal y tipo de pago igual que siempre.
function esDescargueHuevosSinPersonal(o: PendingLoadOrder): boolean {
  return !!o.esDescargueHuevos
}

export function Packing() {
  const { toast } = useToast()
  const { profile, selectedEmpresaId } = useAuth()
  const [orders, setOrders] = useState<PendingLoadOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [generatingPDF, setGeneratingPDF] = useState<number | null>(null)

  // Ordenes con una pausa abierta (por `ordendecargue`) y la que se esta
  // pausando/reanudando en este momento, para bloquear su boton.
  const [pausedOrders, setPausedOrders] = useState<Set<string>>(new Set())
  const [pausingOrder, setPausingOrder] = useState<string | null>(null)

  const [personnelDialogOpen, setPersonnelDialogOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<PendingLoadOrder | null>(null)
  const [personnel, setPersonnel] = useState<PersonnelEmployee[]>([])
  const [selectedPersonnel, setSelectedPersonnel] = useState<string[]>([])
  const [loadingPersonnel, setLoadingPersonnel] = useState(false)
  const [assigningPersonnel, setAssigningPersonnel] = useState(false)
  const [auxiliaresInput, setAuxiliaresInput] = useState("")

  const [showPackingView, setShowPackingView] = useState(false)
  const [packingItems, setPackingItems] = useState<PackingItem[]>([])
  const [verifiedItems, setVerifiedItems] = useState<Set<number>>(new Set())
  const [loadingPacking, setLoadingPacking] = useState(false)
  const [confirmingPacking, setConfirmingPacking] = useState(false)

  const [photoDialogOpen, setPhotoDialogOpen] = useState(false)
  // Dos entradas de archivo: el carrete del dispositivo y la cámara (ver el diálogo de fotos).
  const galeriaInputRef = useRef<HTMLInputElement>(null)
  const camaraInputRef = useRef<HTMLInputElement>(null)
  const [selectedPhotosOrder, setSelectedPhotosOrder] = useState<PendingLoadOrder | null>(null)
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState<string[]>([])

  const [confirmedPackingOrders, setConfirmedPackingOrders] = useState<Set<number>>(new Set())

  const isMobile = useIsMobile()

  // Function to compress image
  const compressImage = async (file: File, quality: number = 0.6, maxWidth: number = 1200): Promise<File> => {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      const img = new Image()
      img.crossOrigin = "anonymous"

      img.onload = () => {
        let { width, height } = img

        // Scale down if larger than maxWidth
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height
        ctx?.drawImage(img, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: "image/jpeg",
                lastModified: Date.now(),
              })
              resolve(compressedFile)
            } else {
              resolve(file) // Fallback to original if compression fails
            }
          },
          "image/jpeg",
          quality
        )
      }

      img.onerror = () => resolve(file) // Fallback to original on error
      img.src = URL.createObjectURL(file)
    })
  }

  const loadOrders = async () => {
    setLoading(true)
    try {
      // Fetch both unload orders (Descargue) and distribution orders (Distribucion)
      const [unloadResult, distributionResult] = await Promise.all([
        getPendingUnloadOrders(selectedEmpresaId),
        getDistributionOrders(selectedEmpresaId),
      ])

      const allOrders: PendingLoadOrder[] = []

      if (unloadResult.success) {
        allOrders.push(...unloadResult.data)
      }

      if (distributionResult.success) {
        allOrders.push(...distributionResult.data)
      }

      if (allOrders.length === 0) {
        toast({
          title: "Información",
          description: "No hay órdenes pendientes",
        })
      }

      // Sort all orders by ordendecargue descending
      allOrders.sort((a, b) => {
        const numA = parseInt(a.ordendecargue, 10)
        const numB = parseInt(b.ordendecargue, 10)
        return numB - numA
      })

      setOrders(allOrders)

      // Ordenes con pausa abierta, para mostrar "Reanudar" en vez de "Pausar".
      const pausadas = await getOrdenesPausadas()
      setPausedOrders(new Set(pausadas))
    } catch (error) {
      console.error("[v0] Error loading orders:", error)
      toast({
        title: "Error",
        description: "Error al cargar las órdenes",
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  /**
   * Pausa o reanuda el descargue de una orden. Misma tabla `pausas` que usa
   * Picking: `inicio` al pausar, `fin` al reanudar.
   */
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
      toast({
        title: estaPausada ? "Descargue reanudado" : "Descargue pausado",
        description: result.message,
      })
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

  const handleAssignPersonnel = async (order: PendingLoadOrder) => {
    setSelectedOrder(order)
    // Precarga los auxiliares YA asignados (si los hay) para poder agregar o
    // quitar sobre lo existente — el personal se puede editar mientras la
    // orden siga abierta, no solo la primera vez.
    setSelectedPersonnel(
      String(order.auxiliares || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    setAuxiliaresInput("")
    setPersonnelDialogOpen(true)

    setLoadingPersonnel(true)
    const result = await getCarguDescarguePersonnel(selectedEmpresaId)

    if (result.success) {
      // "Personal disponible" ya excluye a quien esté asignado a CUALQUIER
      // orden activa — incluida esta misma que se está editando. Para poder
      // agregar o quitar sobre lo ya asignado, la lista del diálogo debe
      // ser: disponibles + quien ya esté en ESTA orden.
      const yaAsignados = String(order.auxiliares || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const yaEnLista = new Set(result.data.map((p) => p.nombreempleado.trim().toUpperCase()))
      const asignadosFaltantes = yaAsignados
        .filter((nombre) => !yaEnLista.has(nombre.trim().toUpperCase()))
        .map((nombre, i) => ({ id: -1000 - i, nombreempleado: nombre }))
      setPersonnel(
        [...result.data, ...asignadosFaltantes].sort((a, b) => a.nombreempleado.localeCompare(b.nombreempleado, "es")),
      )
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setLoadingPersonnel(false)
  }

  const togglePersonnelSelection = (employeeName: string) => {
    setSelectedPersonnel((prev) =>
      prev.includes(employeeName) ? prev.filter((name) => name !== employeeName) : [...prev, employeeName],
    )
  }

  const handleConfirmAssignment = async () => {
    if (!selectedOrder) return
    // Un vehículo pausado no está descargando: su personal se puede
    // reasignar por completo a otro servicio, sin dejar a nadie "reservado"
    // acá. La exigencia de mínimo 1 solo aplica a una orden activa.
    if (selectedPersonnel.length === 0 && !pausedOrders.has(selectedOrder.ordendecargue)) {
      toast({
        title: "Error",
        description: "Debe seleccionar al menos un empleado",
        variant: "destructive",
      })
      return
    }

    const currentUserName = profile?.usuario || "Usuario desconocido"

    setAssigningPersonnel(true)
    // Cast type-only: la firma difiere pero la llamada es la vigente (app en uso).
    const result = await (assignPersonnelToOrder as any)(
      selectedOrder.id,
      selectedPersonnel,
      auxiliaresInput,
      currentUserName,
      selectedOrder,
    )

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message,
      })
      setPersonnelDialogOpen(false)
      setAuxiliaresInput("")
      await loadOrders()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setAssigningPersonnel(false)
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

  const handlePerformPacking = async (order: PendingLoadOrder) => {
    setSelectedOrder(order)
    setShowPackingView(true)

    setLoadingPacking(true)
    const result = await getPackingItems(order.ordendecargue)

    if (result.success) {
      setPackingItems(result.data)
      setVerifiedItems(new Set())
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setLoadingPacking(false)
  }

  const handleConfirmPacking = async () => {
    if (!selectedOrder) return

    try {
      setConfirmingPacking(true)
      const result = await confirmPacking(selectedOrder.id)

      if (result.success) {
        setConfirmedPackingOrders((prev) => new Set(prev).add(selectedOrder.id))

        toast({
          title: "Éxito",
          description: "Packing confirmado exitosamente",
        })
        setShowPackingView(false)
        setSelectedOrder(null)
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al confirmar el packing",
          variant: "destructive",
        })
      }
    } catch (error: any) {
      console.error("[v0] Error confirming packing:", error)
      toast({
        title: "Error",
        description: error.message || "Error al confirmar el packing",
        variant: "destructive",
      })
    } finally {
      setConfirmingPacking(false)
    }
  }

  const handleGeneratePDF = async (order: PendingLoadOrder) => {
    setGeneratingPDF(order.id)
    console.log("[v0] Packing: Starting PDF generation for order:", order.id)
    
    const result = await generatePackingPDF(
      order.id,
      order.ordendecargue,
      order.cliente,
      order.placa,
      order.conductor,
      order.tipooperacion,
    )

    if (result.success && result.pdfUrl) {
      // Generar el PDF ya NO marca el inicio de la operación para la mayoría
      // de órdenes: eso lo hace asignar el muelle en Centro de Coordinación,
      // que es el momento en que el vehículo deja de esperar en patio y ocupa
      // el puesto. Antes esta pantalla escribía `iniciocargue` y pisaba la
      // hora real del muelle. EXCEPCIÓN: los clones de Distribución "+D"
      // nunca pasan por muelle (están excluidos a propósito) — para ellos
      // `generatePackingPDF` sí escribe `iniciocargue` acá mismo, porque es
      // su único punto de inicio real.
      console.log("[v0] Packing: PDF generated successfully")

      toast({
        title: "Éxito",
        description: "PDF generado exitosamente",
      })
      window.open(result.pdfUrl, "_blank")
      // Refresca la lista: para un clon "+D" esto es lo que trae el
      // `iniciocargue` recién escrito y habilita "Asignar Personal" sin
      // esperar a un refresco manual.
      await loadOrders()
    } else {
      console.log("[v0] Packing: PDF generation failed")
      toast({
        title: "Error",
        description: result.error || "Error al generar el PDF",
        variant: "destructive",
      })
    }
    setGeneratingPDF(null)
  }

  const handleUploadPhotos = (order: PendingLoadOrder) => {
    setSelectedPhotosOrder(order)
    setSelectedPhotos([])
    setPhotoPreviewUrls([])
    setPhotoDialogOpen(true)
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    // Se limpia el input para que el mismo archivo (o la misma camara) pueda
    // volver a usarse: sin esto, elegir dos veces seguidas no dispara el cambio
    // y las fotos de la segunda tanda se perderian en silencio.
    e.target.value = ""

    if (files.length + selectedPhotos.length > 30) {
      toast({
        title: "Error",
        description: "Máximo 30 fotos permitidas",
        variant: "destructive",
      })
      return
    }

    const newPreviewUrls = files.map((file) => URL.createObjectURL(file))
    setPhotoPreviewUrls([...photoPreviewUrls, ...newPreviewUrls])
    setSelectedPhotos([...selectedPhotos, ...files])
  }

  const handleRemovePhoto = (index: number) => {
    const newPhotos = selectedPhotos.filter((_, i) => i !== index)
    const newPreviews = photoPreviewUrls.filter((_, i) => i !== index)

    URL.revokeObjectURL(photoPreviewUrls[index])

    setSelectedPhotos(newPhotos)
    setPhotoPreviewUrls(newPreviews)
  }

  const handleSavePhotos = async () => {
    if (!selectedPhotosOrder || selectedPhotos.length === 0) {
      toast({
        title: "Error",
        description: "Debe seleccionar al menos una foto",
        variant: "destructive",
      })
      return
    }

    setUploadingPhotos(true)

    try {
      // Comprimimos SIEMPRE (no solo con >5). Las camaras de movil
      // generan archivos de 3-5MB cada uno; sumar varios en un solo
      // POST excede el limite ~4.5MB de Vercel y la peticion ni
      // siquiera entra al endpoint, dejando el dialog colgado en
      // "Guardando..." sin que el usuario pueda cerrar.
      toast({
        title: "Optimizando fotos",
        description: `Procesando ${selectedPhotos.length} foto(s)...`,
      })
      const photosToUpload = await Promise.all(
        selectedPhotos.map((photo) => compressImage(photo, 0.6, 1280)),
      )

      // Subimos foto a foto en peticiones independientes para evitar
      // el limite de tamano del body. Si alguna falla abortamos sin
      // finalizar la orden y mostramos el error real del servidor.
      const orderId = selectedPhotosOrder.id.toString()
      const urls: string[] = []
      for (let i = 0; i < photosToUpload.length; i++) {
        const photo = photosToUpload[i]
        toast({
          title: "Subiendo fotos",
          description: `Subiendo ${i + 1} de ${photosToUpload.length}...`,
        })
        const fd = new FormData()
        fd.append("orderId", orderId)
        fd.append("mode", "append")
        fd.append("files", photo)
        const res = await fetch("/api/upload-picking-photos", {
          method: "POST",
          body: fd,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.success || !Array.isArray(data?.urls)) {
          throw new Error(
            data?.error ||
              data?.details ||
              `Error subiendo la foto ${i + 1}. Intenta nuevamente.`,
          )
        }
        urls.push(...data.urls)
      }

      // Llamada de cierre (modo "finalize"): solo manda JSON, no
      // archivos, asi siempre cabe en el body y siempre cierra la
      // orden persistiendo `fotospicking` y `fincargue`.
      const finalizeFd = new FormData()
      finalizeFd.append("orderId", orderId)
      finalizeFd.append("mode", "finalize")
      finalizeFd.append("urls", JSON.stringify(urls))
      const finalizeRes = await fetch("/api/upload-picking-photos", {
        method: "POST",
        body: finalizeFd,
      })
      const finalizeData = await finalizeRes.json().catch(() => ({}))
      if (!finalizeRes.ok || !finalizeData?.success) {
        throw new Error(
          finalizeData?.error ||
            finalizeData?.details ||
            "No se pudo cerrar la orden tras subir las fotos",
        )
      }

      toast({
        title: "Éxito",
        description: `${urls.length} foto(s) guardadas exitosamente`,
      })
      setPhotoDialogOpen(false)
      setSelectedPhotos([])
      setPhotoPreviewUrls([])
      await loadOrders()
    } catch (error: any) {
      console.error("[v0] Error uploading photos:", error)
      toast({
        title: "Error",
        description: error?.message || "Error al guardar las fotos",
        variant: "destructive",
      })
    } finally {
      setUploadingPhotos(false)
    }
  }

  if (showPackingView && selectedOrder) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-4">
          <Button onClick={() => setShowPackingView(false)} variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-2xl font-bold">Verificación de Packing - {selectedOrder.ordendecargue}</h2>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Productos para Verificar</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPacking ? (
              <div className="text-center py-8">Cargando productos...</div>
            ) : (
              <div className="space-y-2">
                {packingItems.map((item) => {
                  const isVerified = verifiedItems.has(item.id)

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-4 p-3 border rounded-lg transition-colors ${
                        isVerified ? "bg-green-50 border-green-200" : ""
                      }`}
                    >
                      <div className="w-24">
                        {isVerified ? (
                          <div className="flex items-center justify-center gap-1 text-green-600">
                            <Check className="h-5 w-5" />
                            <span className="font-semibold text-sm">Verificado</span>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSimpleVerification(item.id)}
                            className="w-full"
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Verificar
                          </Button>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{item.producto}</div>
                        <div className="text-sm text-muted-foreground">Cantidad: {item.cantidad}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button onClick={() => setShowPackingView(false)} variant="outline">
                Cancelar
              </Button>
              <Button
                onClick={handleConfirmPacking}
                disabled={confirmingPacking || verifiedItems.size !== packingItems.length}
              >
                {confirmingPacking ? "Confirmando..." : "Confirmar Packing"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Órdenes de Descargue Pendientes</CardTitle>
          <Button onClick={loadOrders} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando órdenes...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No hay órdenes de descargue pendientes</div>
        ) : (
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr>
                    <th className="py-1 px-2 text-left font-semibold">Orden</th>
                    <th className="py-1 px-2 text-left font-semibold">Fecha Orden</th>
                    <th className="py-1 px-2 text-left font-semibold">Fecha Descargue</th>
                    <th className="py-1 px-2 text-left font-semibold">Cliente</th>
                    <th className="py-1 px-2 text-left font-semibold">Placa</th>
                    <th className="py-1 px-2 text-left font-semibold">Conductor</th>
                    <th className="py-1 px-2 text-center font-semibold">Facturar</th>
                    <th className="py-1 px-2 text-left font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b hover:bg-muted/50">
                      <td className="py-1 px-2">{order.ordendecargue}</td>
                      <td className="py-1 px-2">{order.fechaorden || "-"}</td>
                      <td className="py-1 px-2">{order.fechacargue || "-"}</td>
                      <td className="py-1 px-2">{order.cliente}</td>
                      <td className="py-1 px-2">{order.placa}</td>
                      <td className="py-1 px-2">{order.conductor}</td>
                      <td className="py-1 px-2 text-center">
                        {/* Facturar: SOLO para distribución. Encendido por defecto; al
                            desmarcar pide confirmación + motivo y registra el cambio.
                            Descargue no tiene esta opción. */}
                        {order.tipooperacion === "Distribucion" ? (
                          <FacturarCheckbox
                            orden={order}
                            facturar={order.facturar}
                            idempresa={selectedEmpresaId}
                            usuario={profile?.usuario}
                            modulo="Packing"
                            disabled={!!order.fincargue}
                            onChanged={(v) =>
                              setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, facturar: v } : o)))
                            }
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-1 px-2">
                        {/* Nuevo flujo de Packing: PDF -> Personal -> Fotos.
                            El cargue de fotos es el paso final y el que cierra
                            la orden (escribe `fincargue`); por eso "Asignar
                            Personal" ya no requiere fotos previas y "Cargar
                            Fotos" pasa a depender de que ya exista personal
                            asignado. */}
                        <div className="flex flex-wrap gap-1">
                          <Button
                            onClick={() => handleGeneratePDF(order)}
                            disabled={generatingPDF === order.id || !!order.iniciocargue}
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] px-2"
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            {generatingPDF === order.id ? "Generando..." : "PDF"}
                          </Button>
                          <Button
                            onClick={() => handleAssignPersonnel(order)}
                            // Una DISTRIBUCIÓN ("…D") marcada "no facturar" NO lleva
                            // auxiliares (si no se factura, no se paga entrega) → se BLOQUEA
                            // asignar personal. La orden se cierra igual con "Cargar Fotos".
                            // Fuera de ese caso, se puede reabrir para agregar o quitar
                            // gente mientras la orden siga abierta (no solo la primera vez).
                            disabled={!order.iniciocargue || esDistribucionNoFacturable(order)}
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[10px] px-2"
                          >
                            <UserPlus className="h-3 w-3 mr-1" />
                            {order.auxiliares ? "Editar Personal" : "Asignar Personal"}
                          </Button>
                          <Button
                            onClick={() => handleUploadPhotos(order)}
                            // Cierre por "Cargar Fotos" (escribe fincargue). Normalmente
                            // requiere personal asignado Y tipo de pago elegido, PERO una
                            // DISTRIBUCIÓN ("…D") marcada "no facturar" no lleva auxiliares
                            // ni necesita tipo de pago, así que se puede cerrar directo. Un
                            // Descargue de Huevos en ID2 tampoco: ese personal se paga aparte.
                            disabled={
                              pausedOrders.has(order.ordendecargue) ||
                              (!esDistribucionNoFacturable(order) &&
                                !esDescargueHuevosSinPersonal(order) &&
                                (!order.auxiliares || (!order.tipo_pago && !esClonDistribucion(order))))
                            }
                            title={pausedOrders.has(order.ordendecargue) ? "Reanuda el descargue antes de cerrar" : undefined}
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] px-2"
                          >
                            <Camera className="h-3 w-3 mr-1" />
                            Cargar Fotos
                          </Button>
                          {/* Pausar / Reanudar el descargue. Disponible desde que
                              la orden arranca (`iniciocargue`, que escribe el PDF)
                              y hasta que se cierra (`fincargue`): pausar algo que
                              no ha empezado o que ya termino no significa nada. */}
                          <Button
                            onClick={() => handleTogglePausa(order)}
                            disabled={
                              !order.iniciocargue ||
                              !!order.fincargue ||
                              pausingOrder === order.ordendecargue
                            }
                            size="sm"
                            variant="outline"
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
                        {/* El tipo de pago (Global/Individual) lo elige el
                            coordinador en Centro de Coordinación, no aquí —
                            Packing solo respeta el bloqueo si aún no se eligió. */}
                        {!esDistribucionNoFacturable(order) && !esDescargueHuevosSinPersonal(order) && order.auxiliares && !order.tipo_pago && !esClonDistribucion(order) && (
                          <div className="mt-1 text-[10px] font-medium text-rose-600">
                            ⚠ Falta elegir tipo de pago en Centro de Coordinación
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>

      {/* Personnel Dialog */}
      <Dialog open={personnelDialogOpen} onOpenChange={setPersonnelDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedOrder?.auxiliares ? "Editar Personal" : "Asignar Personal"} - {selectedOrder?.ordendecargue}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Usuario Actual</Label>
              <Input value={profile?.usuario || "Usuario desconocido"} disabled className="bg-muted" />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Auxiliares</Label>
              <Textarea
                value={auxiliaresInput}
                onChange={(e) => setAuxiliaresInput(e.target.value)}
                placeholder="Ingrese los nombres de los auxiliares separados por comas"
                rows={3}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-sm font-medium">Seleccionar Personal</Label>
                {selectedOrder && pausedOrders.has(selectedOrder.ordendecargue) && selectedPersonnel.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedPersonnel([])}
                  >
                    Quitar todos
                  </Button>
                )}
              </div>
              {loadingPersonnel ? (
                <div className="text-center py-4">Cargando personal...</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {personnel.map((emp) => (
                    <div
                      key={emp.id}
                      className={`p-2 border rounded cursor-pointer transition-colors ${
                        selectedPersonnel.includes(emp.nombreempleado)
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      }`}
                      onClick={() => togglePersonnelSelection(emp.nombreempleado)}
                    >
                      {emp.nombreempleado}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setPersonnelDialogOpen(false)} variant="outline">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmAssignment}
              disabled={assigningPersonnel || (selectedPersonnel.length === 0 && !(selectedOrder && pausedOrders.has(selectedOrder.ordendecargue)))}
            >
              {assigningPersonnel
                ? "Asignando..."
                : selectedPersonnel.length === 0
                  ? "Quitar todo el personal"
                  : "Confirmar Asignación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Upload Dialog */}
      <Dialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Cargar Fotos - {selectedPhotosOrder?.ordendecargue}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              {/*
                DOS CAMINOS: el carrete del dispositivo y la camara.

                Reportado por el coordinador de ID2 el 2026-10-07: no se podian adjuntar
                fotos ya tomadas y para cerrar la orden tocaba volver a tomarlas. La causa
                era un solo input con `capture="environment"`: en el celular ese atributo
                abre la camara directo y QUITA la opcion de galeria. Ademas anulaba el
                `multiple`, porque la camara entrega una foto a la vez, asi que el limite de
                30 era inalcanzable desde el telefono.

                Mismo patron que `ciclo-facturacion/adjuntos-uploader.tsx`: dos inputs
                ocultos, uno limpio para el dispositivo y otro con `capture` para la camara,
                y un boton para cada uno. En computador el primero abre el explorador de
                archivos, como siempre.
              */}
              <input
                ref={galeriaInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
                onChange={handlePhotoChange}
              />
              <input
                ref={camaraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-hidden="true"
                tabIndex={-1}
                onChange={handlePhotoChange}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => galeriaInputRef.current?.click()}>
                  <FileText className="mr-2 h-4 w-4" />
                  Elegir del dispositivo
                </Button>
                <Button variant="outline" onClick={() => camaraInputRef.current?.click()}>
                  <Camera className="mr-2 h-4 w-4" />
                  Tomar foto
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Máximo 30 fotos. {selectedPhotos.length} seleccionadas. Puedes combinar fotos del dispositivo con fotos
                tomadas ahora.
              </p>
            </div>

            {photoPreviewUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2 max-h-96 overflow-y-auto">
                {photoPreviewUrls.map((url, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={url || "/placeholder.svg"}
                      alt={`Preview ${index + 1}`}
                      className="w-full h-32 object-cover rounded"
                    />
                    <Button
                      onClick={() => handleRemovePhoto(index)}
                      variant="destructive"
                      size="sm"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setPhotoDialogOpen(false)} variant="outline">
              Cancelar
            </Button>
            <Button onClick={handleSavePhotos} disabled={uploadingPhotos || selectedPhotos.length === 0}>
              {uploadingPhotos ? "Guardando..." : "Guardar Fotos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
