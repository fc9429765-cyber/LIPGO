"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, AlertTriangle } from "lucide-react"
import {
  getAvailableLoadOrders,
  getOrderProducts,
  getInventoryForProduct,
  approveBatchAllocation,
} from "@/lib/batch-actions"
import type { LoadOrder, OrderProduct } from "@/lib/batch-actions"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"

interface LotAllocation {
  detalleocId: number // Added to track the specific detalleoc line
  productName: string
  cliente: string
  orderQuantity: number
  allocations: {
    codproducto: string
    nombreproducto: string
    lote: string
    location: string
    stock_actual: number
    cantidadDescontar: number
    // Marca el lote como "Lote alterno": su cantidad NO suma al asignado de la
    // linea NI se descuenta del restante (el restante refleja solo los lotes
    // firmes). Se resalta en amarillo.
    esAlterno: boolean
  }[]
}

interface ClienteGroup {
  cliente: string
  products: LotAllocation[]
}

// Comparador de texto tolerante a NULL. saldoinvdetalle puede traer
// codproducto/lote/location vacios y detalleoc puede traer cliente vacio: la
// base no lo impide aunque los tipos los declaren `string`. Sin esto,
// `null.localeCompare(...)` lanza y tumba el render completo del modulo.
const compararTexto = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").localeCompare(b ?? "")

export function BatchApproval() {
  const [loadOrders, setLoadOrders] = useState<LoadOrder[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string>("")
  const [selectedOrderCode, setSelectedOrderCode] = useState<string>("")
  const [selectedOrderPlaca, setSelectedOrderPlaca] = useState<string>("")
  const [orderProducts, setOrderProducts] = useState<OrderProduct[]>([])
  const [lotAllocations, setLotAllocations] = useState<LotAllocation[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingInventory, setLoadingInventory] = useState(false)
  const [approving, setApproving] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false) // Added for confirmation button state
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  useEffect(() => {
    loadAvailableOrders()
    // Reset selection when empresa changes
    setSelectedOrderId("")
    setSelectedOrderCode("")
    setSelectedOrderPlaca("")
    setOrderProducts([])
    setLotAllocations([])
  }, [selectedEmpresaId])

  const loadAvailableOrders = async () => {
    setLoading(true)
    try {
      const orders = await getAvailableLoadOrders(selectedEmpresaId)
      setLoadOrders(orders)
    } catch (error) {
      console.error("Error loading orders:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedOrderId) {
      loadOrderProducts()
    } else {
      setOrderProducts([])
      setLotAllocations([])
    }
  }, [selectedOrderId])

  const loadOrderProducts = async () => {
    if (!selectedOrderId) return

    setLoadingInventory(true)
    try {
      const products = await getOrderProducts(Number.parseInt(selectedOrderId))
      setOrderProducts(products)

      const allocations: LotAllocation[] = []
      for (const product of products) {
        const inventory = await getInventoryForProduct(product.producto, selectedEmpresaId)
        allocations.push({
          detalleocId: product.id, // Track the specific detalleoc line
          productName: product.producto,
          cliente: product.cliente,
          orderQuantity: product.cantidad,
          allocations: inventory.map((inv) => ({
            ...inv,
            cantidadDescontar: 0,
            esAlterno: false,
          })),
        })
      }
      setLotAllocations(allocations)
    } catch (error) {
      console.error("Error loading products:", error)
    } finally {
      setLoadingInventory(false)
    }
  }

  const updateAllocation = (detalleocId: number, lote: string, location: string, value: number) => {
    setLotAllocations((prev) =>
      prev.map((allocation) => {
        if (allocation.detalleocId === detalleocId) {
          return {
            ...allocation,
            allocations: allocation.allocations.map((inv) => {
              if (inv.lote === lote && inv.location === location) {
                return { ...inv, cantidadDescontar: value }
              }
              return inv
            }),
          }
        }
        return allocation
      }),
    )
  }

  // Marca/desmarca un lote como "Lote alterno".
  const toggleAlterno = (detalleocId: number, lote: string, location: string, checked: boolean) => {
    setLotAllocations((prev) =>
      prev.map((allocation) => {
        if (allocation.detalleocId === detalleocId) {
          return {
            ...allocation,
            allocations: allocation.allocations.map((inv) => {
              if (inv.lote === lote && inv.location === location) {
                return { ...inv, esAlterno: checked }
              }
              return inv
            }),
          }
        }
        return allocation
      }),
    )
  }

  // Total general (firme + alterno): se usa para el restante y validaciones.
  const getTotalAllocated = (detalleocId: number) => {
    const allocation = lotAllocations.find((a) => a.detalleocId === detalleocId)
    if (!allocation) return 0
    return allocation.allocations.reduce((sum, inv) => sum + inv.cantidadDescontar, 0)
  }

  // Asignado firme: NO incluye los lotes alternos.
  const getTotalFirme = (detalleocId: number) => {
    const allocation = lotAllocations.find((a) => a.detalleocId === detalleocId)
    if (!allocation) return 0
    return allocation.allocations.reduce((sum, inv) => sum + (inv.esAlterno ? 0 : inv.cantidadDescontar), 0)
  }

  // Cantidad asignada como lote alterno.
  const getTotalAlterno = (detalleocId: number) => {
    const allocation = lotAllocations.find((a) => a.detalleocId === detalleocId)
    if (!allocation) return 0
    return allocation.allocations.reduce((sum, inv) => sum + (inv.esAlterno ? inv.cantidadDescontar : 0), 0)
  }

  // Stock firme aun disponible para asignar (lotes NO alternos).
  const getFirmFreeStock = (detalleocId: number) => {
    const allocation = lotAllocations.find((a) => a.detalleocId === detalleocId)
    if (!allocation) return 0
    return allocation.allocations.reduce(
      (sum, inv) => sum + (inv.esAlterno ? 0 : Math.max(0, inv.stock_actual - inv.cantidadDescontar)),
      0,
    )
  }

  // Una linea "exige" lote alterno cuando ya se agoto todo el stock firme
  // disponible, aun falta cantidad por asignar y no se ha marcado un alterno.
  const lineNeedsAlterno = (allocation: LotAllocation) => {
    const firme = getTotalFirme(allocation.detalleocId)
    const alterno = getTotalAlterno(allocation.detalleocId)
    const remaining = allocation.orderQuantity - firme - alterno
    const firmFree = getFirmFreeStock(allocation.detalleocId)
    return remaining > 0 && firmFree === 0 && alterno === 0
  }

  const groupedByCliente: ClienteGroup[] = lotAllocations.reduce((acc, allocation) => {
    const existingGroup = acc.find((g) => g.cliente === allocation.cliente)
    if (existingGroup) {
      existingGroup.products.push(allocation)
    } else {
      acc.push({
        cliente: allocation.cliente,
        products: [allocation],
      })
    }
    return acc
  }, [] as ClienteGroup[])

  const getInventorySummary = () => {
    const summaryMap = new Map<
      string,
      {
        codproducto: string
        nombreproducto: string
        lote: string
        location: string
        stock_actual: number
        totalDescontar: number
        esAlterno: boolean
      }
    >()

    lotAllocations.forEach((allocation) => {
      allocation.allocations.forEach((inv) => {
        const key = `${inv.codproducto}-${inv.lote}-${inv.location}`
        const existing = summaryMap.get(key)

        if (existing) {
          existing.totalDescontar += inv.cantidadDescontar
          if (inv.esAlterno && inv.cantidadDescontar > 0) existing.esAlterno = true
        } else {
          summaryMap.set(key, {
            codproducto: inv.codproducto,
            nombreproducto: inv.nombreproducto,
            lote: inv.lote,
            location: inv.location,
            stock_actual: inv.stock_actual,
            totalDescontar: inv.cantidadDescontar,
            esAlterno: inv.esAlterno && inv.cantidadDescontar > 0,
          })
        }
      })
    })

    return Array.from(summaryMap.values()).sort((a, b) => {
      if (a.codproducto !== b.codproducto) return compararTexto(a.codproducto, b.codproducto)
      if (a.lote !== b.lote) return compararTexto(a.lote, b.lote)
      return compararTexto(a.location, b.location)
    })
  }

  const calculateBatchAge = (lote: string): number => {
    if (!lote || lote.length !== 8) return 0

    try {
      const year = Number.parseInt(lote.substring(0, 4))
      const month = Number.parseInt(lote.substring(4, 6)) - 1 // Month is 0-indexed
      const day = Number.parseInt(lote.substring(6, 8))

      const loteDate = new Date(year, month, day)
      const today = new Date()

      // Calculate difference in milliseconds and convert to days
      const diffTime = today.getTime() - loteDate.getTime()
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

      return diffDays
    } catch (error) {
      console.error("[v0] Error calculating batch age:", error)
      return 0
    }
  }

  const autoAssign = () => {
    const newAllocations = lotAllocations.map((allocation) => ({
      ...allocation,
      allocations: allocation.allocations.map((inv) => ({
        ...inv,
        cantidadDescontar: 0,
      })),
    }))

    const globalInventoryUsage = new Map<string, number>()

    const sortedAllocations = [...newAllocations].sort((a, b) => compararTexto(a.cliente, b.cliente))

    sortedAllocations.forEach((allocation) => {
      let remainingToAllocate = allocation.orderQuantity

      const sortedInventory = [...allocation.allocations].sort((a, b) => {
        if (a.lote !== b.lote) {
          return compararTexto(a.lote, b.lote)
        }
        return compararTexto(a.location, b.location)
      })

      for (const inv of sortedInventory) {
        if (remainingToAllocate <= 0) break

        const key = `${inv.codproducto}-${inv.lote}-${inv.location}`
        const alreadyUsed = globalInventoryUsage.get(key) || 0
        const availableStock = inv.stock_actual - alreadyUsed

        if (availableStock > 0) {
          const toAllocate = Math.min(remainingToAllocate, availableStock)
          inv.cantidadDescontar = toAllocate
          globalInventoryUsage.set(key, alreadyUsed + toAllocate)
          remainingToAllocate -= toAllocate
        }
      }
    })

    setLotAllocations(newAllocations)
  }

  const handleOrderChange = (orderId: string) => {
    setSelectedOrderId(orderId)
    const order = loadOrders.find((o) => o.id.toString() === orderId)
    if (order) {
      setSelectedOrderCode(order.ordendecargue)
      setSelectedOrderPlaca(order.placa || "Sin vehículo asignado")
    }
  }

  const handleApproveBatch = async () => {
    if (!selectedOrderCode) {
      toast({
        title: "Error",
        description: "No hay una orden de cargue seleccionada",
        variant: "destructive",
      })
      return
    }

    const lineRequiringAlterno = lotAllocations.find((allocation) => lineNeedsAlterno(allocation))
    if (lineRequiringAlterno) {
      toast({
        title: "Lote alterno requerido",
        description: `El producto "${lineRequiringAlterno.productName}" agotó el inventario de los lotes asignados y aún falta cantidad. Marque un Lote alterno (casilla amarilla) para completar la asignación.`,
        variant: "destructive",
      })
      return
    }

    const hasNegativeRemaining = lotAllocations.some((allocation) => {
      // El restante solo considera el firme: el lote alterno no debe generar
      // restante negativo ni bloquear la confirmacion.
      const totalFirme = getTotalFirme(allocation.detalleocId)
      const remaining = allocation.orderQuantity - totalFirme
      return remaining < 0
    })

    if (hasNegativeRemaining) {
      toast({
        title: "Error",
        description:
          "No se puede confirmar. Hay productos con cantidad asignada mayor al pedido (valores restantes negativos). Por favor, corrija las cantidades.",
        variant: "destructive",
      })
      return
    }

    const hasIncompleteProducts = lotAllocations.some((allocation) => {
      const totalAllocated = getTotalAllocated(allocation.detalleocId)
      const remaining = allocation.orderQuantity - totalAllocated
      return remaining !== 0
    })

    if (hasIncompleteProducts) {
      const confirmed = window.confirm("¿Estás seguro de aprobar el lote para una cantidad menor al pedido?")
      if (!confirmed) {
        return
      }
    }

    const allocationsToApprove: {
      cliente: string
      producto: string
      lote: string
      location: string
      cantidad: number
      esAlterno: boolean
    }[] = []

    lotAllocations.forEach((allocation) => {
      allocation.allocations.forEach((inv) => {
        if (inv.cantidadDescontar > 0) {
          allocationsToApprove.push({
            cliente: allocation.cliente,
            producto: allocation.productName,
            lote: inv.lote,
            location: inv.location,
            cantidad: inv.cantidadDescontar,
            esAlterno: inv.esAlterno,
          })
        }
      })
    })

    if (allocationsToApprove.length === 0) {
      toast({
        title: "Error",
        description: "No hay cantidades asignadas para aprobar",
        variant: "destructive",
      })
      return
    }

    const hasExceededStock = getInventorySummary().some((s) => s.totalDescontar > s.stock_actual)
    if (hasExceededStock) {
      toast({
        title: "Error al aprobar lotes",
        description: "Algunas combinaciones superan el stock disponible. Corrija las cantidades antes de aprobar.",
        variant: "destructive",
      })
      return
    }

    setApproving(true)
    try {
      const result = await approveBatchAllocation(
        {
          ordendecargue: selectedOrderCode,
          allocations: allocationsToApprove,
        },
        selectedEmpresaId,
      )

      if (!result.success) {
        toast({ title: "Salida duplicada — no permitida", description: result.error || "", variant: "destructive" })
        return
      }

      toast({
        title: "Lotes aprobados exitosamente",
        description: `Se registraron ${result.recordsInserted} asignaciones en el historial de lotes`,
      })

      if (result.pdfUrl) {
        const link = document.createElement("a")
        link.href = result.pdfUrl
        link.target = "_blank"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }

      setSelectedOrderId("")
      setSelectedOrderCode("")
      setSelectedOrderPlaca("")
      setOrderProducts([])
      setLotAllocations([])
      loadAvailableOrders()
    } catch (error: any) {
      console.error("[v0] Error approving batch:", error)
      toast({
        title: "Error al aprobar lotes",
        description: error?.message || "Ocurrió un error al registrar la aprobación. Por favor intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setApproving(false)
    }
  }

  const handleConfirmAllocation = async () => {
    if (!selectedOrderCode) {
      toast({
        title: "Error",
        description: "No hay una orden de cargue seleccionada",
        variant: "destructive",
      })
      return
    }

    // Check for negative remaining quantities
    const lineRequiringAlterno = lotAllocations.find((allocation) => lineNeedsAlterno(allocation))
    if (lineRequiringAlterno) {
      toast({
        title: "Lote alterno requerido",
        description: `El producto "${lineRequiringAlterno.productName}" agotó el inventario de los lotes asignados y aún falta cantidad. Marque un Lote alterno (casilla amarilla) para completar la asignación.`,
        variant: "destructive",
      })
      return
    }

    const hasNegativeRemaining = lotAllocations.some((allocation) => {
      // El restante solo considera el firme: el lote alterno no debe generar
      // restante negativo ni bloquear la confirmacion.
      const totalFirme = getTotalFirme(allocation.detalleocId)
      const remaining = allocation.orderQuantity - totalFirme
      return remaining < 0
    })

    if (hasNegativeRemaining) {
      toast({
        title: "Error",
        description:
          "No se puede confirmar. Hay productos con cantidad asignada mayor al pedido (valores restantes negativos). Por favor, corrija las cantidades.",
        variant: "destructive",
      })
      return
    }

    // Check for incomplete products
    const hasIncompleteProducts = lotAllocations.some((allocation) => {
      const totalAllocated = getTotalAllocated(allocation.detalleocId)
      const remaining = allocation.orderQuantity - totalAllocated
      return remaining !== 0
    })

    if (hasIncompleteProducts) {
      const confirmed = window.confirm("¿Estás seguro de aprobar el lote para una cantidad menor al pedido?")
      if (!confirmed) {
        return
      }
    }

    // Prepare allocations to approve
    const allocationsToApprove: {
      cliente: string
      producto: string
      lote: string
      location: string
      cantidad: number
      esAlterno: boolean
    }[] = []

    lotAllocations.forEach((allocation) => {
      allocation.allocations.forEach((inv) => {
        if (inv.cantidadDescontar > 0) {
          allocationsToApprove.push({
            cliente: allocation.cliente,
            producto: allocation.productName,
            lote: inv.lote,
            location: inv.location,
            cantidad: inv.cantidadDescontar,
            esAlterno: inv.esAlterno,
          })
        }
      })
    })

    if (allocationsToApprove.length === 0) {
      toast({
        title: "Error",
        description: "No hay cantidades asignadas para aprobar",
        variant: "destructive",
      })
      return
    }

    // Check for exceeded stock
    const hasExceededStock = getInventorySummary().some((s) => s.totalDescontar > s.stock_actual)
    if (hasExceededStock) {
      toast({
        title: "Error al aprobar lotes",
        description: "Algunas combinaciones superan el stock disponible. Corrija las cantidades antes de aprobar.",
        variant: "destructive",
      })
      return
    }

    setIsConfirming(true)
    try {
      const result = await approveBatchAllocation(
        {
          ordendecargue: selectedOrderCode,
          allocations: allocationsToApprove,
        },
        selectedEmpresaId,
      )

      if (!result.success) {
        toast({ title: "Salida duplicada — no permitida", description: result.error || "", variant: "destructive" })
        return
      }

      toast({
        title: "Lotes aprobados exitosamente",
        description: `Se registraron ${result.recordsInserted} asignaciones en el historial de lotes`,
      })

      // Open PDF in new tab
      if (result.pdfUrl) {
        const link = document.createElement("a")
        link.href = result.pdfUrl
        link.target = "_blank"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }

      // Reset form
      setSelectedOrderId("")
      setSelectedOrderCode("")
      setSelectedOrderPlaca("")
      setOrderProducts([])
      setLotAllocations([])
      loadAvailableOrders()
    } catch (error: any) {
      console.error("[v0] Error approving batch:", error)
      toast({
        title: "Error al aprobar lotes",
        description: error?.message || "Ocurrió un error al registrar la aprobación. Por favor intente nuevamente.",
        variant: "destructive",
      })
    } finally {
      setIsConfirming(false)
    }
  }

  const inventorySummary = getInventorySummary()

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl md:text-2xl font-bold">Aprobación de Lotes</h1>
        {groupedByCliente.length > 0 && (
          <Button onClick={autoAssign} variant="secondary" size="sm" className="h-8 md:h-9 text-xs md:text-sm">
            Auto asignar
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="p-4 md:p-6">
          <CardTitle className="text-base md:text-lg">Seleccionar Orden de Cargue</CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="orden" className="text-xs md:text-sm">
                Orden de Cargue
              </Label>
              <Select value={selectedOrderId} onValueChange={handleOrderChange} disabled={loading}>
                <SelectTrigger id="orden" className="h-8 md:h-9 text-xs md:text-sm">
                  <SelectValue placeholder="Seleccione una orden de cargue" />
                </SelectTrigger>
                <SelectContent>
                  {loadOrders.map((order) => (
                    <SelectItem key={order.id} value={order.id.toString()}>
                      {order.ordendecargue}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedOrderId && (
              <div className="p-3 bg-muted rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs md:text-sm font-medium">Placa del vehículo:</span>
                  <span className="text-xs md:text-sm text-muted-foreground">{selectedOrderPlaca}</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {loadingInventory && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 md:h-8 md:w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground text-xs md:text-sm">Cargando inventario...</span>
        </div>
      )}

      {!loadingInventory && groupedByCliente.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <Accordion type="multiple" className="space-y-3 md:space-y-4">
              {groupedByCliente.map((clienteGroup) => (
                <AccordionItem key={clienteGroup.cliente} value={clienteGroup.cliente} className="border rounded-lg">
                  <Card>
                    <AccordionTrigger className="px-3 md:px-6 py-3 md:py-4 hover:no-underline">
                      <div className="flex items-center justify-between w-full pr-2 md:pr-4">
                        <h2 className="text-sm md:text-xl font-semibold">Cliente: {clienteGroup.cliente}</h2>
                        <span className="text-xs md:text-sm text-muted-foreground">
                          {clienteGroup.products.length} línea(s)
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <CardContent className="pt-3 md:pt-4 px-3 md:px-6">
                        <Accordion type="multiple" className="space-y-2">
                          {clienteGroup.products.map((allocation) => {
                            const totalFirme = getTotalFirme(allocation.detalleocId)
                            const totalAlterno = getTotalAlterno(allocation.detalleocId)
                            // El restante solo considera los lotes firmes: el
                            // lote alterno no resta del restante de la linea.
                            const remaining = allocation.orderQuantity - totalFirme
                            const needsAlterno = lineNeedsAlterno(allocation)

                            return (
                              <AccordionItem
                                key={allocation.detalleocId}
                                value={allocation.detalleocId.toString()}
                                className="border rounded-lg"
                              >
                                <Card>
                                  <AccordionTrigger className="px-3 md:px-4 py-2 md:py-3 hover:no-underline">
                                    <div className="flex items-center justify-between w-full pr-2 md:pr-4 flex-wrap gap-2">
                                      <span className="font-medium text-xs md:text-sm flex items-center gap-1.5">
                                        {allocation.productName} (ID: {allocation.detalleocId})
                                        {needsAlterno && (
                                          <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 shrink-0" />
                                        )}
                                      </span>
                                      <div className="text-xs md:text-sm space-x-2 md:space-x-4">
                                        <span>Pedido: {allocation.orderQuantity}</span>
                                        <span
                                          className={totalFirme > allocation.orderQuantity ? "text-red-500" : ""}
                                        >
                                          Asignado: {totalFirme}
                                        </span>
                                        {totalAlterno > 0 && (
                                          <span className="text-yellow-700 font-medium">
                                            Alterno: {totalAlterno}
                                          </span>
                                        )}
                                        <span
                                          className={
                                            remaining === 0 ? "text-green-500" : remaining < 0 ? "text-red-500" : ""
                                          }
                                        >
                                          Restante: {remaining}
                                        </span>
                                      </div>
                                    </div>
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <CardContent className="pt-3 md:pt-4 px-3 md:px-4">
                                      {needsAlterno && (
                                        <div className="mb-3 flex items-start gap-2 p-2 md:p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
                                          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
                                          <p className="text-xs md:text-sm text-yellow-800">
                                            Se agotó el inventario de los lotes asignados y aún falta cantidad por
                                            cubrir. Marque la casilla <strong>Alterno</strong> en el lote que usará
                                            como lote alterno para completar la asignación.
                                          </p>
                                        </div>
                                      )}
                                      <div className="border rounded-lg overflow-x-auto">
                                        <table className="w-full min-w-[640px]">
                                          <thead className="bg-muted">
                                            <tr>
                                              <th className="px-2 md:px-4 py-2 text-left text-xs font-medium">
                                                Código
                                              </th>
                                              <th className="px-2 md:px-4 py-2 text-left text-xs font-medium">Lote</th>
                                              <th className="px-2 md:px-4 py-2 text-left text-xs font-medium">
                                                Edad del Lote
                                              </th>
                                              <th className="px-2 md:px-4 py-2 text-left text-xs font-medium">
                                                Location
                                              </th>
                                              <th className="px-2 md:px-4 py-2 text-right text-xs font-medium">
                                                Stock
                                              </th>
                                              <th className="px-2 md:px-4 py-2 text-right text-xs font-medium">
                                                Cantidad
                                              </th>
                                              <th className="px-2 md:px-4 py-2 text-center text-xs font-medium">
                                                Alterno
                                              </th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {allocation.allocations.length === 0 ? (
                                              <tr>
                                                <td
                                                  colSpan={7}
                                                  className="px-2 md:px-4 py-6 md:py-8 text-center text-muted-foreground text-xs"
                                                >
                                                  No hay inventario disponible para este producto
                                                </td>
                                              </tr>
                                            ) : (
                                              allocation.allocations.map((inv, idx) => {
                                                const batchAge = calculateBatchAge(inv.lote)
                                                const isOld = batchAge > 15

                                                return (
                                                  <tr
                                                    key={`${allocation.detalleocId}-${inv.lote}-${inv.location}`}
                                                    className={
                                                      inv.esAlterno
                                                        ? "bg-yellow-200"
                                                        : isOld
                                                          ? "bg-yellow-50"
                                                          : ""
                                                    }
                                                  >
                                                    <td className="px-2 md:px-4 py-2 text-xs">{inv.codproducto}</td>
                                                    <td className="px-2 md:px-4 py-2 text-xs">
                                                      {inv.lote}
                                                      {inv.esAlterno && (
                                                        <span className="ml-1 text-yellow-700 font-semibold">
                                                          (lote alterno)
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td
                                                      className={`px-2 md:px-4 py-2 text-xs ${isOld ? "text-yellow-700 font-semibold" : ""}`}
                                                    >
                                                      {batchAge} días{isOld ? " ⚠️" : ""}
                                                    </td>
                                                    <td className="px-2 md:px-4 py-2 text-xs">{inv.location}</td>
                                                    <td className="px-2 md:px-4 py-2 text-right text-xs">
                                                      {inv.stock_actual}
                                                    </td>
                                                    <td className="px-2 md:px-4 py-2">
                                                      <Input
                                                        type="number"
                                                        min="0"
                                                        max={inv.stock_actual}
                                                        value={inv.cantidadDescontar}
                                                        onChange={(e) =>
                                                          updateAllocation(
                                                            allocation.detalleocId,
                                                            inv.lote,
                                                            inv.location,
                                                            Number.parseInt(e.target.value) || 0,
                                                          )
                                                        }
                                                        className="w-20 h-7 text-xs"
                                                      />
                                                    </td>
                                                    <td className="px-2 md:px-4 py-2 text-center">
                                                      <Checkbox
                                                        checked={inv.esAlterno}
                                                        aria-label="Marcar como lote alterno"
                                                        onCheckedChange={(checked) =>
                                                          toggleAlterno(
                                                            allocation.detalleocId,
                                                            inv.lote,
                                                            inv.location,
                                                            checked === true,
                                                          )
                                                        }
                                                      />
                                                    </td>
                                                  </tr>
                                                )
                                              })
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </CardContent>
                                  </AccordionContent>
                                </Card>
                              </AccordionItem>
                            )
                          })}
                        </Accordion>
                      </CardContent>
                    </AccordionContent>
                  </Card>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* Summary Panel */}
          <div className="lg:col-span-1">
            <Card className="sticky top-4">
              <CardHeader className="p-3 md:p-6">
                <CardTitle className="text-sm md:text-base">Resumen por Lote y Location</CardTitle>
              </CardHeader>
              <CardContent className="p-3 md:p-6">
                <div className="border rounded-lg overflow-x-auto">
                  <table className="w-full text-xs md:text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-2 md:px-3 py-2 text-left text-xs font-medium">Código</th>
                        <th className="px-2 md:px-3 py-2 text-left text-xs font-medium">Lote</th>
                        <th className="px-2 md:px-3 py-2 text-left text-xs font-medium">Loc.</th>
                        <th className="px-2 md:px-3 py-2 text-right text-xs font-medium">Stock</th>
                        <th className="px-2 md:px-3 py-2 text-right text-xs font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventorySummary.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-2 md:px-3 py-6 md:py-8 text-center text-muted-foreground text-xs"
                          >
                            Sin asignaciones
                          </td>
                        </tr>
                      ) : (
                        inventorySummary.map((summary, idx) => {
                          const exceeds = summary.totalDescontar > summary.stock_actual
                          return (
                            <tr
                              key={`${summary.codproducto}-${summary.lote}-${summary.location}-${idx}`}
                              className={`border-t ${exceeds ? "bg-red-50" : summary.esAlterno ? "bg-yellow-200" : ""}`}
                            >
                              <td className="px-2 md:px-3 py-2 text-xs">{summary.codproducto}</td>
                              <td className="px-2 md:px-3 py-2 text-xs">
                                {summary.lote}
                                {summary.esAlterno && (
                                  <span className="ml-1 text-yellow-700 font-semibold">(alt.)</span>
                                )}
                              </td>
                              <td className="px-2 md:px-3 py-2 text-xs">{summary.location}</td>
                              <td
                                className={`px-2 md:px-3 py-2 text-xs text-right ${exceeds ? "text-red-600 font-semibold" : ""}`}
                              >
                                {summary.stock_actual}
                              </td>
                              <td
                                className={`px-2 md:px-3 py-2 text-xs text-right ${exceeds ? "text-red-600 font-semibold" : ""}`}
                              >
                                {summary.totalDescontar}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {inventorySummary.some((s) => s.totalDescontar > s.stock_actual) && (
                  <div className="mt-3 md:mt-4 p-2 md:p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-xs md:text-sm text-red-600 font-medium">
                      ⚠️ Algunas combinaciones superan el stock disponible
                    </p>
                  </div>
                )}

                <div className="mt-4 md:mt-6">
                  <Button
                    onClick={handleConfirmAllocation}
                    disabled={
                      inventorySummary.length === 0 ||
                      inventorySummary.some((s) => s.totalDescontar > s.stock_actual) ||
                      isConfirming
                    }
                    className="w-full"
                  >
                    {isConfirming ? "Confirmando..." : "Confirmar Asignación"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
