"use client"

/**
 * Modulo "Montacargas y personal día" (Gestion de Inventario).
 *
 * CRUD + visor sencillo sobre la tabla `montacargasdia`. Operaciones:
 *   - Listar registros de la empresa actual (ordenados por fecha DESC).
 *   - Crear: la `fecha` y el `idempresa` se llenan automaticamente; las
 *     "personas" vienen precargadas desde `registroasistencia` (puesto
 *     no nulo) y son editables antes de guardar.
 *   - Editar: permite ajustar los campos del formulario.
 *   - Eliminar: con confirmacion.
 *
 * El acceso al modulo va protegido por el permiso `montacargasdia`
 * (ver `lib/permissions-map.ts`). La proteccion se aplica desde
 * `main-content.tsx` con `<PermissionGuard moduleName="Montacargas y personal día">`.
 */

import { useState, useEffect, useCallback, useMemo } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Loader2, Plus, Pencil, Trash2, Truck, Users, CalendarDays, Download, FilterX } from "lucide-react"
import {
  createMontacargasDia,
  deleteMontacargasDia,
  getMontacargasDia,
  getPersonasPrecargadas,
  updateMontacargasDia,
  type MontacargasDiaInput,
  type MontacargasDiaRow,
} from "@/lib/montacargas-dia-actions"

// Form inicial vacio. Centralizado para resetear con facilidad y para
// que tanto "crear" como "cancelar edicion" partan de aqui.
const EMPTY_FORM: MontacargasDiaInput = {
  montacargas1: false,
  montacargas2: false,
  personas: null,
  aprueba: null,
  comentarios: null,
}

/**
 * Formatea una fecha ISO (`YYYY-MM-DD`) como `DD/MM/YYYY` para mostrar
 * en la tabla. Si llega vacia/invalida devuelve "-".
 */
function formatFecha(iso: string | null): string {
  if (!iso) return "-"
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}/${m}/${y}`
}

export default function MontacargasDia() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()

  const [rows, setRows] = useState<MontacargasDiaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Estado del dialog de formulario. `editingId` distingue crear (null)
  // de editar (id numerico). Se mantiene junto a `form` para que crear
  // y editar usen el mismo flujo de UI.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<MontacargasDiaInput>(EMPTY_FORM)

  // Estado del dialog de confirmacion de borrado.
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Filtros de rango de fecha (YYYY-MM-DD). Vacios = sin limite por ese
  // extremo. El filtrado es en cliente porque `row.fecha` ya viene en
  // formato ISO comparable lexicograficamente.
  const [fechaDesde, setFechaDesde] = useState<string>("")
  const [fechaHasta, setFechaHasta] = useState<string>("")

  // Filas visibles tras aplicar el rango de fecha. Como `fecha` es
  // `YYYY-MM-DD`, la comparacion de strings equivale a comparar fechas.
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!row.fecha) return false
      if (fechaDesde && row.fecha < fechaDesde) return false
      if (fechaHasta && row.fecha > fechaHasta) return false
      return true
    })
  }, [rows, fechaDesde, fechaHasta])

  const hayFiltro = fechaDesde !== "" || fechaHasta !== ""

  const limpiarFiltros = () => {
    setFechaDesde("")
    setFechaHasta("")
  }

  /**
   * Exporta las filas visibles (ya filtradas) a un archivo .xlsx real
   * usando SheetJS. Cada campo queda en su propia celda/columna y los
   * tipos (numero/texto) se respetan, en lugar de un CSV separado por
   * comas.
   */
  const exportarExcel = async () => {
    const XLSX = await import("xlsx")
    // Cada objeto del arreglo es una fila; las claves son los encabezados.
    const data = filteredRows.map((row) => ({
      Fecha: formatFecha(row.fecha),
      "Montacargas 1": row.montacargas1 ? "Disponible" : "No disponible",
      "Montacargas 2": row.montacargas2 ? "Disponible" : "No disponible",
      Personas: row.personas ?? 0,
      Aprueba: row.aprueba ?? "",
      Comentarios: (row.comentarios ?? "").replace(/\r?\n/g, " "),
    }))

    const worksheet = XLSX.utils.json_to_sheet(data)
    // Anchos de columna para una lectura comoda en Excel.
    worksheet["!cols"] = [
      { wch: 14 }, // Fecha
      { wch: 16 }, // Montacargas 1
      { wch: 16 }, // Montacargas 2
      { wch: 10 }, // Personas
      { wch: 22 }, // Aprueba
      { wch: 40 }, // Comentarios
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Montacargas")

    const rango = hayFiltro ? `_${fechaDesde || "inicio"}_a_${fechaHasta || "hoy"}` : ""
    XLSX.writeFile(workbook, `montacargas_personal${rango}.xlsx`)
  }

  const loadRows = useCallback(async () => {
    if (!selectedEmpresaId) return
    setLoading(true)
    const res = await getMontacargasDia(selectedEmpresaId)
    if (res.success && res.data) {
      setRows(res.data)
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudieron cargar los registros",
        variant: "destructive",
      })
    }
    setLoading(false)
  }, [selectedEmpresaId, toast])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  /**
   * Abre el dialogo de "Nuevo registro". Resetea el form al estado
   * vacio y precarga `personas` consultando `registroasistencia` para
   * el dia actual (puesto NOT NULL). Si la consulta falla, dejamos el
   * valor en null y avisamos con un toast no bloqueante.
   */
  const openCreate = async () => {
    if (!selectedEmpresaId) return
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)

    const res = await getPersonasPrecargadas(selectedEmpresaId)
    if (res.success && typeof res.data === "number") {
      setForm((prev) => ({ ...prev, personas: res.data ?? null }))
    } else if (res.error) {
      toast({
        title: "Aviso",
        description:
          "No se pudo precargar el personal del día. Puedes capturarlo manualmente.",
      })
    }
  }

  /**
   * Abre el dialogo en modo edicion. Carga los valores del registro
   * existente en el form, manteniendo el `id` en `editingId`.
   */
  const openEdit = (row: MontacargasDiaRow) => {
    setEditingId(row.id)
    setForm({
      montacargas1: row.montacargas1 ?? false,
      montacargas2: row.montacargas2 ?? false,
      personas: row.personas,
      aprueba: row.aprueba,
      comentarios: row.comentarios,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!selectedEmpresaId) return
    setSaving(true)
    const res = editingId
      ? await updateMontacargasDia(selectedEmpresaId, editingId, form)
      : await createMontacargasDia(selectedEmpresaId, form)
    setSaving(false)

    if (res.success) {
      toast({
        title: editingId ? "Registro actualizado" : "Registro creado",
        description: editingId
          ? "Los cambios se guardaron correctamente."
          : "El registro se guardó correctamente.",
      })
      setDialogOpen(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      await loadRows()
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo guardar el registro",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async () => {
    if (!selectedEmpresaId || !deletingId) return
    setDeleting(true)
    const res = await deleteMontacargasDia(selectedEmpresaId, deletingId)
    setDeleting(false)
    if (res.success) {
      toast({
        title: "Registro eliminado",
        description: "El registro se borró correctamente.",
      })
      setDeletingId(null)
      await loadRows()
    } else {
      toast({
        title: "Error",
        description: res.error || "No se pudo eliminar el registro",
        variant: "destructive",
      })
    }
  }

  // Indicador visual reutilizable para los booleanos `montacargas1/2`.
  // Mantiene la coherencia entre la tabla y el formulario.
  const renderEstadoMontacargas = (value: boolean | null) => {
    if (value === true) {
      return (
        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
          Disponible
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="border-muted text-muted-foreground">
        No disponible
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Montacargas y personal día</h2>
          <p className="text-sm text-muted-foreground">
            Registro diario de disponibilidad de montacargas y personal de operación.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!selectedEmpresaId} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo registro
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Registros
          </CardTitle>
          <CardDescription>
            Los registros se asocian automáticamente a la fecha actual y a la empresa seleccionada.
          </CardDescription>

          {/* Filtros de rango de fecha + exportar a Excel */}
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="fecha-desde" className="text-xs font-medium text-muted-foreground">
                  Desde
                </Label>
                <DatePickerField
                  id="fecha-desde"
                  value={fechaDesde}
                  maxDate={fechaHasta || undefined}
                  onChange={setFechaDesde}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fecha-hasta" className="text-xs font-medium text-muted-foreground">
                  Hasta
                </Label>
                <DatePickerField
                  id="fecha-hasta"
                  value={fechaHasta}
                  minDate={fechaDesde || undefined}
                  onChange={setFechaHasta}
                  className="w-full sm:w-44"
                />
              </div>
              {hayFiltro && (
                <Button variant="ghost" onClick={limpiarFiltros} className="gap-2 text-muted-foreground">
                  <FilterX className="h-4 w-4" />
                  Limpiar
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              onClick={exportarExcel}
              disabled={filteredRows.length === 0}
              className="gap-2 bg-transparent"
            >
              <Download className="h-4 w-4" />
              Exportar a Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <CalendarDays className="h-8 w-8" />
              <p className="text-sm">Aún no hay registros para esta empresa.</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
              <CalendarDays className="h-8 w-8" />
              <p className="text-sm">No hay registros en el rango de fechas seleccionado.</p>
            </div>
          ) : (
            <>
              {/*
                Scroll vertical con header fijo (`sticky`) para que la
                tabla no crezca indefinidamente. `max-h` limita el alto
                visible y el overflow habilita ambos scrolls.
              */}
              <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Montacargas 1</TableHead>
                      <TableHead>Montacargas 2</TableHead>
                      <TableHead className="text-right">Personas</TableHead>
                      <TableHead>Aprueba</TableHead>
                      <TableHead>Comentarios</TableHead>
                      <TableHead className="w-32 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{formatFecha(row.fecha)}</TableCell>
                        <TableCell>{renderEstadoMontacargas(row.montacargas1)}</TableCell>
                        <TableCell>{renderEstadoMontacargas(row.montacargas2)}</TableCell>
                        <TableCell className="text-right">
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3.5 w-3.5 text-muted-foreground" />
                            {row.personas ?? 0}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.aprueba ? (
                            row.aprueba
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm max-w-xs">
                          {/*
                            Comentarios pueden ser largos. Truncamos
                            visualmente con `line-clamp-2` para no romper
                            el alto de la fila, y exponemos el contenido
                            completo en el `title` (tooltip nativo) para
                            que el usuario pueda leerlo sin abrir el
                            dialog de edicion.
                          */}
                          {row.comentarios ? (
                            <span
                              className="line-clamp-2 whitespace-pre-wrap text-pretty"
                              title={row.comentarios}
                            >
                              {row.comentarios}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 bg-transparent"
                              onClick={() => openEdit(row)}
                              aria-label="Editar registro"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 bg-transparent text-destructive hover:text-destructive"
                              onClick={() => setDeletingId(row.id)}
                              aria-label="Eliminar registro"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Mostrando {filteredRows.length} de {rows.length} registro
                {rows.length === 1 ? "" : "s"}.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialog de creacion / edicion */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar registro" : "Nuevo registro"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Modifica los valores y guarda los cambios."
                : "La fecha se asignará automáticamente al día actual y se asociará a la empresa seleccionada."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <div className="flex flex-col">
                <Label className="text-sm font-medium">Montacargas 1</Label>
                <span className="text-xs text-muted-foreground">
                  Marca si está operativo el día de hoy.
                </span>
              </div>
              <Switch
                checked={!!form.montacargas1}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, montacargas1: checked }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
              <div className="flex flex-col">
                <Label className="text-sm font-medium">Montacargas 2</Label>
                <span className="text-xs text-muted-foreground">
                  Marca si está operativo el día de hoy.
                </span>
              </div>
              <Switch
                checked={!!form.montacargas2}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, montacargas2: checked }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="personas">Personas</Label>
              <Input
                id="personas"
                type="number"
                min={0}
                inputMode="numeric"
                value={form.personas ?? ""}
                onChange={(e) => {
                  const raw = e.target.value
                  setForm((prev) => ({
                    ...prev,
                    personas: raw === "" ? null : Number(raw),
                  }))
                }}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Precargado desde el registro de asistencia del día (personal con hora de
                ingreso registrada). Puedes editarlo si necesitas ajustarlo manualmente.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="aprueba">Aprueba</Label>
              <Input
                id="aprueba"
                type="text"
                value={form.aprueba ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    aprueba: e.target.value || null,
                  }))
                }
                placeholder="Nombre del responsable"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="comentarios">Comentarios</Label>
              {/*
                Texto libre para observaciones del dia (novedades,
                incidentes, motivos por los que un montacargas no opera,
                etc.). Normalizamos cadenas vacias a `null` para no
                guardar strings vacias en BD — coherente con el resto
                de campos opcionales.
              */}
              <Textarea
                id="comentarios"
                value={form.comentarios ?? ""}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    comentarios: e.target.value || null,
                  }))
                }
                placeholder="Observaciones del día, incidentes, novedades..."
                rows={4}
                className="resize-y"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
                setEditingId(null)
                setForm(EMPTY_FORM)
              }}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Guardar cambios" : "Guardar registro"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de confirmacion de borrado */}
      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar registro</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El registro se borrará permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
