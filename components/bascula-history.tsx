"use client"

import { useState, useEffect } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Loader2, Download, Pencil, Eye, EyeOff, Receipt, Scale, Info } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { getBasculaHistory, updateBasculaRecord } from "@/lib/bascula-actions"
import { useAuth } from "@/components/auth-provider"
import { useSubmoduloFiltro } from "@/components/submodulo-filtro-context"
import { BasculaOrderDetailsDialog } from "@/components/bascula-order-details-dialog"
import { KpiCard } from "@/components/orders/dashboard-pedidos/kpi-card"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow } from "@/components/ui/lipgo"
import { cn } from "@/lib/utils"
import { useClaveAccion } from "@/components/clave-accion-provider"

const EDIT_PASSWORD = "Jeff123456"

// Diferencia "sospechosa" entre báscula y producto: más del 10% del peso del
// producto, con un piso de 0.5 t para no marcar en rojo órdenes chiquitas por
// la variación normal de pesaje. Ayuda a detectar un tiquete mal digitado.
function diferenciaAnomala(diferencia: number | null, tonProducto: number | null): boolean {
  if (diferencia == null || tonProducto == null || tonProducto <= 0) return false
  return Math.abs(diferencia) > Math.max(0.5, tonProducto * 0.1)
}

interface BasculaHistoryRecord {
  id: number
  ordendecargue: string
  fechaorden: string
  fechacargue: string
  placa: string
  // Transporte asignado a la orden en cabeceraoc. Se puede editar
  // desde el modal "Editar Registro Báscula".
  transporte: string | null
  tiquetebascula: string
  pesoorden: number
  pesovascula: number
  // Comparación contra el detalle REAL de la orden (Σ detalleoc.toneladas),
  // para detectar de un vistazo un tiquete de báscula mal digitado.
  tonProducto: number | null
  diferencia: number | null
}

export function BasculaHistory() {
  const { selectedEmpresaId } = useAuth()
  const { conClave } = useClaveAccion()
  // Solo las PLANTAS (idempresa 1/2) tienen báscula física. Los CEDIS (3/4 y
  // cualquier otra empresa) por ahora no la tienen: su peso se calcula desde
  // los productos de la orden, no desde un pesaje real — este historial no
  // les aplica (el backend ya filtra sus datos, esto solo informa por qué).
  const esCedi = !!selectedEmpresaId && selectedEmpresaId !== 1 && selectedEmpresaId !== 2
  // Publica el filtro de periodo (desde/hasta) a la tarjeta de KPIs de arriba
  // ("Indicadores — Recepción y Despacho"), para que las toneladas mostradas
  // sean las del MISMO periodo que se está filtrando en esta tabla.
  const { setFiltro: setKpiFiltro } = useSubmoduloFiltro()
  const [data, setData] = useState<BasculaHistoryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // Filtros — desde/hasta filtra por RANGO sobre fechaorden (el mismo campo que
  // usa la tarjeta de toneladas de arriba, para que ambas coincidan).
  const [desdeFilter, setDesdeFilter] = useState("")
  const [hastaFilter, setHastaFilter] = useState("")
  const [placaFilter, setPlacaFilter] = useState("")
  const [ordenFilter, setOrdenFilter] = useState("")
  const [tiqueteFilter, setTiqueteFilter] = useState("")

  // Publicar el filtro de periodo a la tira de KPIs superior.
  useEffect(() => {
    setKpiFiltro({ anio: null, mes: null, desde: desdeFilter || null, hasta: hastaFilter || null })
  }, [desdeFilter, hastaFilter, setKpiFiltro])
  // Al salir del submódulo, limpiar el filtro para que otros módulos usen su
  // resumen por defecto.
  useEffect(() => () => setKpiFiltro({ anio: null, mes: null, desde: null, hasta: null }), [setKpiFiltro])

  // Details dialog state (productos + lotes por orden de cargue)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedOrden, setSelectedOrden] = useState<string | null>(null)
  const [selectedPlaca, setSelectedPlaca] = useState<string | null>(null)

  // Dialog de detalle completo al tocar una de las tarjetas de pendientes
  // (evita el truncado a 3 órdenes del subtexto de la tarjeta).
  const [pendingDialogTipo, setPendingDialogTipo] = useState<"tiquete" | "peso" | null>(null)

  const openDetails = (record: BasculaHistoryRecord) => {
    setSelectedOrden(record.ordendecargue || null)
    setSelectedPlaca(record.placa || null)
    setDetailsOpen(true)
  }

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<BasculaHistoryRecord | null>(null)
  const [editStep, setEditStep] = useState<"password" | "edit">("password")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [newPeso, setNewPeso] = useState("")
  const [newTiquete, setNewTiquete] = useState("")
  const [newTransporte, setNewTransporte] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (selectedEmpresaId) {
      loadData()
    }
  }, [selectedEmpresaId])

  const loadData = async () => {
    setLoading(true)
    try {
      const result = await getBasculaHistory(selectedEmpresaId)
      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudieron cargar los datos del historial de báscula.", variant: "destructive" })
        setData([])
      } else {
        setData(result.data || [])
      }
    } catch (error) {
      toast({ title: "Error", description: "Error al cargar los datos.", variant: "destructive" })
      setData([])
    } finally {
      setLoading(false)
    }
  }

  const openEditDialog = (record: BasculaHistoryRecord) => {
    setEditRecord(record)
    setEditStep("password")
    setPassword("")
    setShowPassword(false)
    setNewPeso(record.pesovascula?.toString() || "")
    setNewTiquete(record.tiquetebascula || "")
    setNewTransporte(record.transporte || "")
    setEditDialogOpen(true)
  }

  const handlePasswordSubmit = () => {
    if (password !== EDIT_PASSWORD) {
      toast({ title: "Contraseña incorrecta", description: "La contraseña ingresada no es válida.", variant: "destructive" })
      return
    }
    setEditStep("edit")
  }

  const handleSaveRecord = async () => {
    if (!editRecord) return
    const parsed = parseFloat(newPeso)
    if (isNaN(parsed) || parsed <= 0) {
      toast({ title: "Valor inválido", description: "Ingresa un peso válido mayor a 0.", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const trimmedTransporte = newTransporte.trim()
      const result = await conClave("Historial Báscula", "editar", (clave) => updateBasculaRecord(
        editRecord.id,
        parsed,
        newTiquete,
        trimmedTransporte, clave))
      if (!result.success) {
        toast({ title: "Error", description: result.error || "No se pudo actualizar el registro.", variant: "destructive" })
        return
      }
      setData((prev) =>
        prev.map((r) =>
          r.id === editRecord.id
            ? {
                ...r,
                pesovascula: parsed,
                tiquetebascula: newTiquete,
                transporte: trimmedTransporte || null,
              }
            : r,
        ),
      )
      toast({ title: "Actualizado", description: "Registro de báscula actualizado correctamente." })
      setEditDialogOpen(false)
    } catch {
      toast({ title: "Error", description: "Error inesperado al guardar.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleExportToExcel = async () => {
    const XLSX = await import("xlsx")
    setExporting(true)
    try {
      const dataToExport = filteredData.map((row) => ({
        "Orden de Cargue": row.ordendecargue || "",
        "Fecha Orden": row.fechaorden || "",
        "Fecha Cargue": row.fechacargue || "",
        Placa: row.placa || "",
        "Tiquete Báscula": row.tiquetebascula || "",
        "Peso Orden (kg)": row.pesoorden || "",
        "Peso Báscula (kg)": row.pesovascula || "",
        "Ton Producto": row.tonProducto ?? "",
        Diferencia: row.diferencia ?? "",
      }))
      const worksheet = XLSX.utils.json_to_sheet(dataToExport)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Historial Báscula")
      XLSX.writeFile(workbook, `historial_bascula_${new Date().toISOString().split("T")[0]}.xlsx`)
      toast({ title: "Éxito", description: "Datos exportados correctamente a Excel." })
    } catch {
      toast({ title: "Error", description: "No se pudo exportar a Excel.", variant: "destructive" })
    } finally {
      setExporting(false)
    }
  }

  const filteredData = data.filter((item) => {
    if (desdeFilter && item.fechaorden < desdeFilter) return false
    if (hastaFilter && item.fechaorden > hastaFilter) return false
    if (placaFilter && !item.placa?.toLowerCase().includes(placaFilter.toLowerCase())) return false
    if (ordenFilter && !item.ordendecargue?.toLowerCase().includes(ordenFilter.toLowerCase())) return false
    if (tiqueteFilter && !item.tiquetebascula?.toLowerCase().includes(tiqueteFilter.toLowerCase())) return false
    return true
  })

  // Toneladas del periodo/filtro actual — mismo criterio que la tarjeta de
  // arriba (Σ pesovascula), para que la tabla y la tarjeta muestren el mismo
  // número aunque la tarjeta consulte directo a la BD (sin paginar 1000 filas
  // como este listado en memoria).
  const toneladasFiltradas = filteredData.reduce((acc, r) => acc + (Number(r.pesovascula) || 0), 0)

  // Toda orden debe tener su tiquete de báscula y su peso de báscula sin
  // excepción (el peso es el insumo para facturar). Se calculan sobre el
  // periodo/filtro actual, igual que el resto de esta pantalla.
  const tiquetesPendientes = filteredData.filter((r) => !r.tiquetebascula || !r.tiquetebascula.trim())
  const pesosPendientes = filteredData.filter((r) => r.pesovascula == null || Number(r.pesovascula) <= 0)

  const resumenPendientes = (rows: BasculaHistoryRecord[]) => {
    if (rows.length === 0) return "Todo al día en el periodo filtrado"
    const nombres = rows.slice(0, 3).map((r) => r.ordendecargue || `#${r.id}`)
    return rows.length > 3
      ? `Órdenes: ${nombres.join(", ")} y ${rows.length - 3} más`
      : `Órdenes: ${nombres.join(", ")}`
  }

  // Alerta visual: mismo número de tiquete repetido en más de una orden.
  // Se calcula sobre TODOS los registros (no solo el filtro actual) para no
  // perder de vista un duplicado cuya otra ocurrencia quedó fuera del filtro.
  const tiqueteCounts = data.reduce<Record<string, number>>((acc, r) => {
    const t = r.tiquetebascula?.trim()
    if (t) acc[t] = (acc[t] || 0) + 1
    return acc
  }, {})

  const pendingDialogRows = pendingDialogTipo === "tiquete" ? tiquetesPendientes : pendingDialogTipo === "peso" ? pesosPendientes : []
  const pendingDialogTitulo =
    pendingDialogTipo === "peso" ? "Pesos de báscula pendientes por ingresar" : "Tiquetes pendientes por ingresar"

  const clearFilters = () => {
    setDesdeFilter("")
    setHastaFilter("")
    setPlacaFilter("")
    setOrdenFilter("")
    setTiqueteFilter("")
  }

  // ---- Solo presentación (gerencia 2026-10-05): filtros, cálculos, exportación, diálogos y la edición con
  // contraseña quedan como estaban. Aquí solo cambia cómo se ve la pantalla. ----
  const hayFiltros = Boolean(desdeFilter || hastaFilter || placaFilter || ordenFilter || tiqueteFilter)
  const NUM = (v: number) => v.toLocaleString("es-CO", { maximumFractionDigits: 0 })
  const DEC = (v: number | null | undefined, d = 2) => (v == null ? "—" : Number(v).toLocaleString("es-CO", { maximumFractionDigits: d }))

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Recepción y Despacho · Báscula · Historial</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Historial de báscula</h1>
          <p className="lg-num text-sm text-muted-foreground">
            {loading ? "Cargando…" : `${NUM(filteredData.length)} de ${NUM(data.length)} órdenes · ${(Math.round(toneladasFiltradas * 10) / 10).toLocaleString("es-CO")} t pesadas en el periodo filtrado`}
          </p>
        </div>
        <Button onClick={handleExportToExcel} disabled={exporting || filteredData.length === 0} size="sm" variant="outline" className="gap-1.5">
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Exportar a Excel
        </Button>
      </div>

      {esCedi && (
        <Alert>
          <Info />
          <AlertTitle>Este CEDI no cuenta con báscula física</AlertTitle>
          <AlertDescription>
            El peso de sus órdenes se calcula a partir de los productos cargados, no de un pesaje real, por lo que
            no aparece en este historial. Cambia a una planta con báscula (Harinera Indupan o Avimol) para ver estos datos.
          </AlertDescription>
        </Alert>
      )}

      {/* Pendientes por ingresar — toda orden debe tener tiquete y peso de báscula */}
      <section className="lg-card grid grid-cols-1 gap-y-4 p-5 sm:grid-cols-2 sm:gap-x-6" aria-label="Pendientes de báscula">
        <button
          type="button"
          className="text-left sm:border-r sm:border-border sm:pr-6 disabled:cursor-default"
          onClick={() => setPendingDialogTipo("tiquete")}
          disabled={tiquetesPendientes.length === 0}
        >
          <Cifra
            label="Tiquetes pendientes por ingresar"
            valor={NUM(tiquetesPendientes.length)}
            tono={tiquetesPendientes.length > 0 ? "critico" : "ok"}
            sub={resumenPendientes(tiquetesPendientes)}
            chips={tiquetesPendientes.length > 0 ? <Chip tono="critico">toda orden debe tener su tiquete</Chip> : <Chip tono="ok">al día</Chip>}
          />
        </button>
        <button
          type="button"
          className="text-left sm:pl-6 disabled:cursor-default"
          onClick={() => setPendingDialogTipo("peso")}
          disabled={pesosPendientes.length === 0}
        >
          <Cifra
            label="Pesos de báscula pendientes"
            valor={NUM(pesosPendientes.length)}
            tono={pesosPendientes.length > 0 ? "critico" : "ok"}
            sub={resumenPendientes(pesosPendientes)}
            chips={pesosPendientes.length > 0 ? <Chip tono="critico">bloquean la facturación</Chip> : <Chip tono="ok">al día</Chip>}
          />
        </button>
      </section>

      {/* Filtros */}
      <section className="lg-card p-4" aria-label="Filtros">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="desde" className="text-xs">Fecha desde</Label>
            <DatePickerField id="desde" value={desdeFilter} onChange={setDesdeFilter} className="h-9 bg-background text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hasta" className="text-xs">Fecha hasta</Label>
            <DatePickerField id="hasta" value={hastaFilter} onChange={setHastaFilter} className="h-9 bg-background text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="placa" className="text-xs">Placa</Label>
            <Input id="placa" type="text" placeholder="Buscar placa…" value={placaFilter} onChange={(e) => setPlacaFilter(e.target.value)} className="h-9 bg-background text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="orden" className="text-xs">Orden de cargue</Label>
            <Input id="orden" type="text" placeholder="Buscar orden…" value={ordenFilter} onChange={(e) => setOrdenFilter(e.target.value)} className="h-9 bg-background text-sm" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tiquete" className="text-xs">Tiquete de báscula</Label>
            <Input id="tiquete" type="text" placeholder="Buscar tiquete…" value={tiqueteFilter} onChange={(e) => setTiqueteFilter(e.target.value)} className="h-9 bg-background text-sm" />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">El filtro de fechas (sobre la fecha de la orden) también actualiza la tarjeta de toneladas de arriba.</p>
          {hayFiltros && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>Limpiar filtros</Button>
          )}
        </div>
      </section>

      {/* Tabla */}
      <section className="lg-card overflow-hidden" aria-label="Órdenes pesadas">
        {loading ? (
          <div className="p-4"><Esqueleto lineas={6} /></div>
        ) : filteredData.length === 0 ? (
          <div className="p-4"><EstadoVacio titulo="No hay registros con esos filtros" /></div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden de cargue</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Tiquete</TableHead>
                  <TableHead className="text-right">Peso orden (kg)</TableHead>
                  <TableHead className="text-right">Peso báscula (kg)</TableHead>
                  <TableHead className="text-right">Producto (t)</TableHead>
                  <TableHead className="text-right">Diferencia (t)</TableHead>
                  <TableHead className="w-24 text-center"><span className="sr-only">Acciones</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((row) => {
                  const tiquete = row.tiquetebascula?.trim()
                  const tiqueteDuplicado = !!tiquete && (tiqueteCounts[tiquete] || 0) > 1
                  const sinTiquete = !tiquete
                  const sinPeso = row.pesovascula == null || Number(row.pesovascula) <= 0
                  const anomala = diferenciaAnomala(row.diferencia, row.tonProducto)
                  return (
                    <TableRow key={row.id} className={cn((sinTiquete || sinPeso) && "bg-critico-bg/40")}>
                      <TableCell>
                        <div className="lg-num font-semibold">{row.ordendecargue || "—"}</div>
                        {row.transporte && <div className="text-xs text-muted-foreground">{row.transporte}</div>}
                      </TableCell>
                      <TableCell className="lg-num whitespace-nowrap">
                        <div>{row.fechaorden || "—"}</div>
                        {row.fechacargue && row.fechacargue !== row.fechaorden && <div className="text-xs text-muted-foreground">cargue {row.fechacargue}</div>}
                      </TableCell>
                      <TableCell className="lg-num">{row.placa || "—"}</TableCell>
                      <TableCell>
                        {sinTiquete ? (
                          <Chip tono="critico">sin tiquete</Chip>
                        ) : tiqueteDuplicado ? (
                          <Chip tono="critico" title="Tiquete duplicado: este número de tiquete se repite en más de una orden">{row.tiquetebascula} · repetido</Chip>
                        ) : (
                          <span className="lg-num">{row.tiquetebascula}</span>
                        )}
                      </TableCell>
                      <TableCell className="lg-num text-right">{DEC(row.pesoorden, 0)}</TableCell>
                      <TableCell className="lg-num text-right">
                        {sinPeso ? <Chip tono="critico">sin peso</Chip> : <span className="font-semibold">{DEC(row.pesovascula, 0)}</span>}
                      </TableCell>
                      <TableCell className="lg-num text-right">{DEC(row.tonProducto, 2)}</TableCell>
                      <TableCell className="text-right">
                        {row.diferencia == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : anomala ? (
                          <Chip tono="atencion" title="Diferencia mayor al 10% entre el peso de báscula y el producto de la orden: revisa el tiquete.">{DEC(row.diferencia, 2)}</Chip>
                        ) : (
                          <span className="lg-num">{DEC(row.diferencia, 2)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openDetails(row)} title="Ver detalle de productos y lotes" aria-label="Ver detalle de productos y lotes" disabled={!row.ordendecargue}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(row)} title="Editar peso de báscula" aria-label="Editar peso de báscula">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="lg-num border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Mostrando {NUM(filteredData.length)} de {NUM(data.length)} registros · {(Math.round(toneladasFiltradas * 10) / 10).toLocaleString("es-CO")} t en el periodo filtrado · en rojo las órdenes sin tiquete o sin peso; en naranja una diferencia mayor al 10 %.
        </p>
      </section>

      <BasculaOrderDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        ordendecargue={selectedOrden}
        placa={selectedPlaca}
      />

      {/* Detalle completo al tocar una tarjeta de pendientes */}
      <Dialog open={pendingDialogTipo !== null} onOpenChange={(open) => !open && setPendingDialogTipo(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{pendingDialogTitulo}</DialogTitle>
            <DialogDescription>
              {pendingDialogRows.length} orden(es) en el periodo filtrado{" "}
              {pendingDialogTipo === "peso"
                ? "sin peso de báscula registrado (bloquean facturación)."
                : "sin tiquete de báscula registrado."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Orden de cargue</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Transporte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingDialogRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-16 text-center text-xs">Sin pendientes.</TableCell>
                  </TableRow>
                ) : (
                  pendingDialogRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="lg-num font-semibold">{r.ordendecargue || "—"}</TableCell>
                      <TableCell className="lg-num">{r.fechaorden || "—"}</TableCell>
                      <TableCell className="lg-num">{r.placa || "—"}</TableCell>
                      <TableCell>{r.transporte || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDialogTipo(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!saving) setEditDialogOpen(open) }}>
        <DialogContent className="sm:max-w-sm">
          {editStep === "password" ? (
            <>
              <DialogHeader>
                <DialogTitle>Verificación de identidad</DialogTitle>
                <DialogDescription>
                  Ingresa la contraseña para editar el peso de báscula de la orden <span className="lg-num font-semibold">{editRecord?.ordendecargue}</span>.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="edit-password">Contraseña</Label>
                <div className="relative">
                  <Input
                    id="edit-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handlePasswordSubmit()}
                    placeholder="Ingresa la contraseña"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handlePasswordSubmit}>Continuar</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Editar registro de báscula</DialogTitle>
                <DialogDescription>
                  Orden <span className="lg-num font-semibold">{editRecord?.ordendecargue}</span> · placa <span className="lg-num font-semibold">{editRecord?.placa}</span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label htmlFor="new-transporte">Transporte</Label>
                  <Input
                    id="new-transporte"
                    type="text"
                    value={newTransporte}
                    onChange={(e) => setNewTransporte(e.target.value)}
                    placeholder="Nombre del transporte"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-tiquete">Tiquete de báscula</Label>
                  <Input
                    id="new-tiquete"
                    type="text"
                    value={newTiquete}
                    onChange={(e) => setNewTiquete(e.target.value)}
                    placeholder="Número de tiquete"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-peso">Peso de báscula (kg)</Label>
                  <Input
                    id="new-peso"
                    type="number"
                    step="0.01"
                    min="0"
                    value={newPeso}
                    onChange={(e) => setNewPeso(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveRecord()}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={handleSaveRecord} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Guardar
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
