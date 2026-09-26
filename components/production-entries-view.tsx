"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Search, FileDown, FileText, Pencil, Trash2, PackagePlus, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  getAllInventoryTransactions,
  updateInventoryTransaction,
  deleteInventoryTransaction,
  updateInvtransOrdentolva,
  getLocations,
  getProductsWithCodes,
  type InventoryTransactionRecord,
  type UpdateInventoryTransactionData,
  type Location,
  type ProductWithCode,
} from "@/lib/inventory-actions"
import { Checkbox } from "@/components/ui/checkbox"
import { Tolva, type PrefilledTolvaLine } from "@/components/tolva"

export function ProductionEntriesView() {
  const { selectedEmpresaId } = useAuth()
  const [transactions, setTransactions] = useState<InventoryTransactionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [transactionToDelete, setTransactionToDelete] = useState<number | null>(null)
  const [selectedTransaction, setSelectedTransaction] = useState<InventoryTransactionRecord | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [products, setProducts] = useState<ProductWithCode[]>([])
  const [processing, setProcessing] = useState(false)
  const { toast } = useToast()

  const [filters, setFilters] = useState({
    producto: "",
    location: "",
    fecha: "",
    lote: "",
  })

  // Filtro por tipo de produccion. Se resuelve en el CLIENTE (no viaja al
  // server action) porque `getAllInventoryTransactions` recibe un contrato de
  // filtros fijo y esto no justifica ampliarlo.
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "LIP" | "Harinera">("todos")

  // `null` = LIP (historico y lo que sube el LOGO).
  const transaccionesVisibles = transactions.filter((t) => {
    if (filtroTipo === "todos") return true
    const esHarinera = t.tipo_produccion === "Harinera"
    return filtroTipo === "Harinera" ? esHarinera : !esHarinera
  })

  // Modo de seleccion masiva para crear una orden de Tolva a partir de
  // ingresos de produccion seleccionados. Cuando `selectionMode` es true se
  // muestra una columna de checkboxes y una barra de acciones.
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Estado del dialog que abre el modulo Tolva con lineas pre-cargadas a
  // partir de los ingresos seleccionados (producto + cantidad).
  const [tolvaDialogOpen, setTolvaDialogOpen] = useState(false)
  const [tolvaPrefilledLines, setTolvaPrefilledLines] = useState<PrefilledTolvaLine[]>([])
  // Encabezado pre-calculado (lote + fecha de fabricacion) que viaja al
  // componente Tolva junto con las lineas pre-cargadas.
  const [tolvaPrefilledLote, setTolvaPrefilledLote] = useState<string>("")
  const [tolvaPrefilledFecha, setTolvaPrefilledFecha] = useState<string>("")
  // Snapshot de los IDs de invtrans que se mandaron a la Tolva. Se preserva
  // aunque el usuario modifique la seleccion, para que tras guardar podamos
  // actualizar `ordentolva` en esas mismas filas.
  const [invtransIdsForTolva, setInvtransIdsForTolva] = useState<number[]>([])

  const [editForm, setEditForm] = useState<UpdateInventoryTransactionData>({
    id: 0,
    idempresa: selectedEmpresaId || 1,
    idproducto: 0,
    codproducto: "",
    nombreproducto: "",
    lote: "",
    location: "",
    cantidad: 0,
    tipomov: "Entrada",
    status: null,
    origen: "",
    creadopor: "",
  })

  useEffect(() => {
    loadData()
  }, [selectedEmpresaId])

  const loadData = async () => {
    if (!selectedEmpresaId) return
    setLoading(true)
    console.log("[v0] Loading production entries for empresa_id:", selectedEmpresaId)
    const [transData, locData, prodData] = await Promise.all([
      getAllInventoryTransactions({
        ...filters,
        tipomov: "Entrada",
        // "ingreso producción" = registro manual (ID1/plantas que producen).
        // "descargue" = ingreso automático de PT a un CEDI (id3/id4) al
        // iniciar un descargue — antes quedaba afuera de esta vista aunque sí
        // aparecía correctamente en "Aprobación de Ingresos de Producción".
        origen: ["ingreso producción", "descargue"],
        idempresa: selectedEmpresaId,
      }),
      getLocations(),
      getProductsWithCodes(),
    ])
    setTransactions(transData)
    setLocations(locData)
    setProducts(prodData)
    setLoading(false)
  }

  const applyFilters = async () => {
    await loadData()
  }

  const clearFilters = () => {
    setFilters({
      producto: "",
      location: "",
      fecha: "",
      lote: "",
    })
  }

  const exportToExcel = async () => {
    const XLSX = await import("xlsx")
    // Lo VISIBLE, para que el archivo coincida con lo que se ve en pantalla.
    const exportData = transaccionesVisibles.map((transaction) => ({
      ID: transaction.id,
      Código: transaction.codproducto,
      Producto: transaction.nombreproducto,
      Lote: transaction.lote,
      Localización: transaction.location,
      Cantidad: transaction.cantidad,
      Tipo: transaction.tipo_produccion === "Harinera" ? "Harinera" : "LIP",
      "Orden Tolva": transaction.ordentolva || "",
      "Creado por": transaction.creadopor,
      Fecha: new Date(transaction.creado).toLocaleDateString(),
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Ingresos de Producción")

    const fecha = new Date().toISOString().split("T")[0]
    const filename = `ingresos_produccion_${fecha}.xlsx`

    XLSX.writeFile(wb, filename)

    toast({
      title: "Éxito",
      description: `Archivo ${filename} descargado exitosamente`,
    })
  }

  const handleViewPDF = (pdfUrl: string | null) => {
    if (!pdfUrl) {
      toast({
        title: "Advertencia",
        description: "Este registro no tiene un PDF asociado",
        variant: "destructive",
      })
      return
    }
    window.open(pdfUrl, "_blank")
  }

  const handleDownloadPDF = (pdfUrl: string | null | undefined, transactionId: number) => {
    if (!pdfUrl) {
      toast({
        title: "Advertencia",
        description: "Este registro no tiene un PDF asociado",
        variant: "destructive",
      })
      return
    }

    const link = document.createElement("a")
    link.href = pdfUrl
    link.download = `ingreso_produccion_${transactionId}.pdf`
    link.target = "_blank"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast({
      title: "Éxito",
      description: "PDF descargado exitosamente",
    })
  }

  const handleEdit = (transaction: InventoryTransactionRecord) => {
    setSelectedTransaction(transaction)
    setEditForm({
      id: transaction.id,
      idempresa: transaction.idempresa,
      idproducto: transaction.idproducto,
      codproducto: transaction.codproducto,
      nombreproducto: transaction.nombreproducto,
      lote: transaction.lote,
      location: transaction.location,
      cantidad: transaction.cantidad,
      tipomov: transaction.tipomov,
      status: transaction.status,
      origen: transaction.origen,
      creadopor: transaction.creadopor,
    })
    setEditDialogOpen(true)
  }

  const handleProductChange = (productId: string) => {
    const product = products.find((p) => p.id === Number.parseInt(productId))
    if (product) {
      setEditForm({
        ...editForm,
        idproducto: product.id,
        codproducto: product.codigo,
        nombreproducto: product.nombre,
      })
    }
  }

  const handleUpdateTransaction = async () => {
    setProcessing(true)
    const result = await updateInventoryTransaction(editForm)

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message,
      })
      await loadData()
      setEditDialogOpen(false)
      setSelectedTransaction(null)
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setProcessing(false)
  }

  const handleDelete = (transactionId: number) => {
    setTransactionToDelete(transactionId)
    setDeleteDialogOpen(true)
  }

  // ---- Selection helpers for "Registrar orden Tolva" ----
  const enterSelectionMode = () => {
    setSelectionMode(true)
    setSelectedIds(new Set())
  }

  const cancelSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const toggleRowSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    // Sobre lo VISIBLE, no sobre todo: si no, con el filtro en "LIP" se
    // seleccionarían tambien las de Harinera que estan ocultas, y luego el
    // envio a Tolva se bloquearía por unas filas que el usuario no ve.
    if (selectedIds.size === transaccionesVisibles.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(transaccionesVisibles.map((t) => t.id)))
    }
  }

  const handleOpenTolvaFromSelection = () => {
    if (selectedIds.size === 0) {
      toast({
        title: "Selecciona al menos una linea",
        description: "Marca los ingresos que quieres incluir en la orden de Tolva",
        variant: "destructive",
      })
      return
    }
    // La produccion PROPIA de Harinera no se liquida ni se factura. Este es el
    // camino MANUAL hacia cabeceraoc: si solo se filtrara Liquidación Tolva,
    // quedaría abierto justamente por aquí.
    const harinera = transactions.filter(
      (t) => selectedIds.has(t.id) && (t as any).tipo_produccion === "Harinera",
    )
    if (harinera.length > 0) {
      toast({
        title: "Hay producción de Harinera seleccionada",
        description:
          `${harinera.length} línea(s) son producción propia de Harinera y no pueden llevarse a Tolva: ` +
          `generan inventario pero no se facturan. Quítalas de la selección para continuar.`,
        variant: "destructive",
      })
      return
    }

    // Consolidar por producto: sumar cantidades cuando un mismo producto
    // aparece en varios ingresos seleccionados.
    const bucket = new Map<string, PrefilledTolvaLine>()
    for (const t of transactions) {
      if (!selectedIds.has(t.id)) continue
      const key = `${t.idproducto}|${t.nombreproducto}`
      const existing = bucket.get(key)
      if (existing) {
        existing.cantidad += Number(t.cantidad) || 0
      } else {
        bucket.set(key, {
          productId: t.idproducto,
          productName: t.nombreproducto,
          cantidad: Number(t.cantidad) || 0,
        })
      }
    }
    setTolvaPrefilledLines(Array.from(bucket.values()))

    // Calcular el lote auto para el encabezado de la Tolva a partir de los
    // lotes de los ingresos seleccionados:
    //   - Si todos comparten el mismo lote, usamos ese.
    //   - Si hay varios distintos, los unimos con " / " para que queden
    //     trazables en cabeceraoc.
    const lotesUnicos = Array.from(
      new Set(
        transactions
          .filter((t) => selectedIds.has(t.id))
          .map((t) => (t.lote || "").trim())
          .filter((l) => l.length > 0),
      ),
    )
    const loteAuto = lotesUnicos.length === 0 ? "" : lotesUnicos.join(" / ")

    // Para la fecha tomamos la mas reciente entre los ingresos seleccionados
    // (fallback a hoy si ninguno trae `creado`).
    const fechasValidas = transactions
      .filter((t) => selectedIds.has(t.id) && t.creado)
      .map((t) => new Date(t.creado as unknown as string).getTime())
      .filter((ms) => !Number.isNaN(ms))
    const fechaAuto =
      fechasValidas.length > 0
        ? new Date(Math.max(...fechasValidas)).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0]

    setTolvaPrefilledLote(loteAuto)
    setTolvaPrefilledFecha(fechaAuto)

    // Guardar snapshot de los ids seleccionados para enlazarlos luego al
    // `ordendecargue` que genere la Tolva.
    setInvtransIdsForTolva(Array.from(selectedIds))
    setTolvaDialogOpen(true)
  }

  const handleTolvaDialogClose = () => {
    setTolvaDialogOpen(false)
    setTolvaPrefilledLines([])
    setTolvaPrefilledLote("")
    setTolvaPrefilledFecha("")
    setInvtransIdsForTolva([])
    setSelectionMode(false)
    setSelectedIds(new Set())
    // Refrescar por si la tolva se guardo y se quiere ver el estado actualizado
    loadData()
  }

  /**
   * Callback invocada por el componente Tolva tras guardar exitosamente.
   * Actualiza el campo `ordentolva` en las filas de `invtrans` seleccionadas
   * con el `ordendecargue` generado (formato "Tolva{id}").
   */
  const handleTolvaSaved = async (info: { id: number; ordendecargue: string }) => {
    if (invtransIdsForTolva.length === 0) return
    const result = await updateInvtransOrdentolva(invtransIdsForTolva, info.ordendecargue)
    if (result.success) {
      toast({
        title: "Ingresos vinculados",
        description: `Se enlazaron ${result.updated ?? invtransIdsForTolva.length} ingresos a la orden ${info.ordendecargue}`,
      })
    } else {
      toast({
        title: "Tolva creada, pero fallo vincular ingresos",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  const confirmDelete = async () => {
    if (!transactionToDelete) return

    setProcessing(true)
    const result = await deleteInventoryTransaction(transactionToDelete)

    if (result.success) {
      toast({
        title: "Éxito",
        description: result.message,
      })
      await loadData()
      setDeleteDialogOpen(false)
      setTransactionToDelete(null)
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
    setProcessing(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ver Ingresos de Producción</CardTitle>
          <CardDescription>Visualiza todos los ingresos de producción registrados</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-medium">Filtros</h3>
              <div className="flex flex-wrap items-center gap-2">
                {!selectionMode ? (
                  <Button onClick={enterSelectionMode} variant="default">
                    <PackagePlus className="h-4 w-4 mr-2" />
                    Asignar auxiliares
                  </Button>
                ) : (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {selectedIds.size} seleccionado{selectedIds.size === 1 ? "" : "s"}
                    </span>
                    <Button
                      onClick={handleOpenTolvaFromSelection}
                      disabled={selectedIds.size === 0}
                    >
                      <PackagePlus className="h-4 w-4 mr-2" />
                      Continuar a Tolva ({selectedIds.size})
                    </Button>
                    <Button onClick={cancelSelection} variant="outline">
                      <X className="h-4 w-4 mr-2" />
                      Cancelar
                    </Button>
                  </>
                )}
                <Button onClick={exportToExcel} variant="outline">
                  <FileDown className="h-4 w-4 mr-2" />
                  Exportar a Excel
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Producto</Label>
                <Input
                  placeholder="Buscar producto..."
                  value={filters.producto}
                  onChange={(e) => setFilters({ ...filters, producto: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Lote</Label>
                <Input
                  placeholder="Buscar lote..."
                  value={filters.lote}
                  onChange={(e) => setFilters({ ...filters, lote: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Localización</Label>
                <Input
                  placeholder="Buscar localización..."
                  value={filters.location}
                  onChange={(e) => setFilters({ ...filters, location: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={filters.fecha}
                  onChange={(e) => setFilters({ ...filters, fecha: e.target.value })}
                />
              </div>

              {/* Filtro en cliente: no requiere volver a consultar. */}
              <div className="space-y-2">
                <Label>Tipo de producción</Label>
                <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v as typeof filtroTipo)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="LIP">LIP</SelectItem>
                    <SelectItem value="Harinera">Harinera</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end gap-2">
                <Button onClick={applyFilters} className="flex-1">
                  <Search className="h-4 w-4 mr-2" />
                  Aplicar
                </Button>
                <Button variant="outline" onClick={clearFilters} className="flex-1 bg-transparent">
                  Limpiar
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-md border overflow-x-auto max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {selectionMode && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={
                          transaccionesVisibles.length > 0 &&
                          selectedIds.size === transaccionesVisibles.length
                        }
                        onCheckedChange={toggleSelectAll}
                        aria-label="Seleccionar todo"
                      />
                    </TableHead>
                  )}
                  <TableHead>ID</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Localización</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Orden Tolva</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Creado por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transaccionesVisibles.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={selectionMode ? 13 : 12}
                      className="text-center text-muted-foreground"
                    >
                      No hay ingresos de producción registrados
                    </TableCell>
                  </TableRow>
                ) : (
                  transaccionesVisibles.map((transaction) => (
                    <TableRow
                      key={transaction.id}
                      data-state={selectedIds.has(transaction.id) ? "selected" : undefined}
                    >
                      {selectionMode && (
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(transaction.id)}
                            onCheckedChange={() => toggleRowSelection(transaction.id)}
                            aria-label={`Seleccionar ingreso ${transaction.id}`}
                          />
                        </TableCell>
                      )}
                      <TableCell>{transaction.id}</TableCell>
                      <TableCell>{transaction.codproducto}</TableCell>
                      <TableCell>{transaction.nombreproducto}</TableCell>
                      <TableCell>{transaction.lote}</TableCell>
                      <TableCell>{transaction.location}</TableCell>
                      <TableCell>{transaction.cantidad}</TableCell>
                      {/* `null` = LIP: es el valor de todo lo historico y de lo
                          que sube el LOGO, asi que se muestra como LIP. */}
                      <TableCell>
                        {transaction.tipo_produccion === "Harinera" ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                            Harinera
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">LIP</span>
                        )}
                      </TableCell>
                      <TableCell>{transaction.ordentolva || "-"}</TableCell>
                      <TableCell>
                        {transaction.status || <span className="text-amber-600 font-medium">Pendiente aprobar</span>}
                      </TableCell>
                      <TableCell>{transaction.creadopor}</TableCell>
                      <TableCell>{new Date(transaction.creado).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDownloadPDF(transaction.pdf, transaction.id)}
                            title="Descargar PDF"
                          >
                            <FileText className="h-4 w-4 text-purple-700" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(transaction)}
                            title={
                              transaction.status && transaction.status !== "Pendiente aprobar"
                                ? "No se puede editar un registro aprobado o rechazado"
                                : "Editar"
                            }
                            disabled={!!(transaction.status && transaction.status !== "Pendiente aprobar")}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(transaction.id)}
                            title={
                              transaction.status && transaction.status !== "Pendiente aprobar"
                                ? "Solo se pueden eliminar registros pendientes de aprobar"
                                : "Eliminar"
                            }
                            disabled={!!(transaction.status && transaction.status !== "Pendiente aprobar")}
                          >
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Ingreso de Producción</DialogTitle>
            <DialogDescription>Modifica los campos del ingreso de producción</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Producto</Label>
              <Select value={editForm.idproducto.toString()} onValueChange={handleProductChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un producto" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id.toString()}>
                      {product.codigo} - {product.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Lote</Label>
              <Input value={editForm.lote} onChange={(e) => setEditForm({ ...editForm, lote: e.target.value })} />
            </div>

            <div className="grid gap-2">
              <Label>Cantidad</Label>
              <Input
                type="number"
                value={editForm.cantidad}
                onChange={(e) => setEditForm({ ...editForm, cantidad: Number.parseFloat(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleUpdateTransaction} disabled={processing}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar Cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={tolvaDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleTolvaDialogClose()
        }}
      >
        <DialogContent className="w-[95vw] sm:max-w-[95vw] lg:max-w-[1400px] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Registrar orden de Tolva</DialogTitle>
            <DialogDescription>
              Se precargaron {tolvaPrefilledLines.length} producto
              {tolvaPrefilledLines.length === 1 ? "" : "s"} a partir de los ingresos de producción
              seleccionados. Verifica la información, completa lote, fecha y personal asignado, y
              guarda la orden.
            </DialogDescription>
          </DialogHeader>
          {tolvaDialogOpen && (
            <Tolva
              prefilledLines={tolvaPrefilledLines}
              prefilledLote={tolvaPrefilledLote}
              prefilledFechaFabricacion={tolvaPrefilledFecha}
              readonly
              onSaved={handleTolvaSaved}
              onClose={handleTolvaDialogClose}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Eliminación</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar este ingreso de producción? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={processing}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={processing}>
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
