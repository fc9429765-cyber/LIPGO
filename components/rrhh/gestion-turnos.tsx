"use client"

/**
 * Modulo "Turnos" (RRHH Lip).
 *
 * CRUD sobre la tabla `tarifasturnos` filtrando SIEMPRE por la empresa
 * seleccionada en el contexto de auth. Cada fila representa un puesto
 * con su tarifa base y los recargos asociados (HED, HEDF, HEN, HEF,
 * HN), su vigencia (fechaini..fechafin) y la hora de entrada del turno.
 *
 * El acceso al modulo va protegido por el permiso `gestionturnos`
 * (ver `lib/permissions-map.ts`). Esta proteccion se aplica desde
 * `main-content.tsx` mediante `<PermissionGuard moduleName="Turnos">`.
 */

import { useState, useEffect, useMemo } from "react"
import { useAuth } from "@/components/auth-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
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
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Search,
  Clock,
  Calendar,
  DollarSign,
} from "lucide-react"
import {
  createTurno,
  deleteTurno,
  getTurnos,
  updateTurno,
  type TurnoInput,
  type TurnoTarifa,
} from "@/lib/turnos-actions"
import { useClaveAccion } from "@/components/clave-accion-provider"

// Estado vacio del formulario. Centralizado para resetear con facilidad
// y para que tanto "crear" como "cancelar edicion" partan de aqui.
const EMPTY_FORM: TurnoInput = {
  fechaini: null,
  fechafin: null,
  base: null,
  hed: null,
  hedf: null,
  hen: null,
  hef: null,
  hn: null,
  puesto: null,
  horaentrada: null,
  // Por defecto un turno NO aplica por tonelada; el usuario lo
  // activa explicitamente cuando corresponde.
  aplicaton: false,
}

export default function GestionTurnos() {
  const { selectedEmpresaId } = useAuth()
  const { conClave } = useClaveAccion()
  const { toast } = useToast()

  const [turnos, setTurnos] = useState<TurnoTarifa[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Estado del dialog. `editingId` distingue entre crear (null) y
  // editar (id numerico). Lo concentramos junto al `form` para que
  // cualquier cambio quede sincronizado.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<TurnoInput>(EMPTY_FORM)

  const [deleteTarget, setDeleteTarget] = useState<TurnoTarifa | null>(null)

  // Filtro de busqueda: aplica sobre `puesto` para localizar turnos
  // entre muchos registros sin recargar la tabla.
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (selectedEmpresaId) {
      void load()
    }
  }, [selectedEmpresaId]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = async () => {
    if (!selectedEmpresaId) return
    setLoading(true)
    const result = await getTurnos(selectedEmpresaId)
    if (result.success && result.data) {
      setTurnos(result.data)
    } else {
      toast({
        title: "Error al cargar turnos",
        description: result.error,
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return turnos
    return turnos.filter((t) => (t.puesto || "").toLowerCase().includes(q))
  }, [turnos, search])

  // ────────────────────────────────────────────────────────────────
  // Helpers de formato
  // ────────────────────────────────────────────────────────────────

  const fmtMoney = (n: number | null) => {
    if (n === null || n === undefined) return "—"
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(n)
  }

  const fmtDate = (v: string | null) => {
    if (!v) return "—"
    // Espera formato "YYYY-MM-DD". Lo normalizamos a "DD/MM/YYYY" para
    // lectura humana.
    const [y, m, d] = v.split("-")
    if (!y || !m || !d) return v
    return `${d}/${m}/${y}`
  }

  const fmtTime = (v: string | null) => {
    if (!v) return "—"
    // `time without time zone` viene como "HH:MM:SS"; mostramos solo HH:MM.
    return v.length >= 5 ? v.substring(0, 5) : v
  }

  // ────────────────────────────────────────────────────────────────
  // Handlers de formulario
  // ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (t: TurnoTarifa) => {
    setEditingId(t.id)
    setForm({
      fechaini: t.fechaini,
      fechafin: t.fechafin,
      base: t.base,
      hed: t.hed,
      hedf: t.hedf,
      hen: t.hen,
      hef: t.hef,
      hn: t.hn,
      puesto: t.puesto,
      // El input type="time" rechaza valores con segundos en algunos
      // navegadores; recortamos a "HH:MM".
      horaentrada: t.horaentrada ? t.horaentrada.substring(0, 5) : null,
      aplicaton: t.aplicaton ?? false,
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!selectedEmpresaId) return
    if (!form.puesto || !form.puesto.trim()) {
      toast({
        title: "Campo requerido",
        description: "Indica el nombre del puesto.",
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    const result = await conClave("Turnos", "configurar", (clave) =>
      editingId ? updateTurno(selectedEmpresaId, editingId, form, clave) : createTurno(selectedEmpresaId, form, clave),
    )

    if (result.success) {
      toast({
        title: editingId ? "Turno actualizado" : "Turno creado",
        description: `Puesto "${form.puesto}" guardado correctamente.`,
      })
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      setEditingId(null)
      await load()
    } else {
      toast({
        title: "Error al guardar",
        description: result.error,
        variant: "destructive",
      })
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!selectedEmpresaId || !deleteTarget) return
    setSaving(true)
    const result = await conClave("Turnos", "configurar", (clave) => deleteTurno(selectedEmpresaId, deleteTarget.id, clave))
    if (result.success) {
      toast({
        title: "Turno eliminado",
        description: `Se elimino "${deleteTarget.puesto || "Sin puesto"}".`,
      })
      setDeleteTarget(null)
      await load()
    } else {
      toast({
        title: "Error al eliminar",
        description: result.error,
        variant: "destructive",
      })
    }
    setSaving(false)
  }

  // Helper para asignar un campo del form preservando el tipado.
  const updateForm = <K extends keyof TurnoInput>(key: K, value: TurnoInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  if (!selectedEmpresaId) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Selecciona una empresa para gestionar los turnos.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Clock className="h-6 w-6 text-primary" />
            Turnos
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Programa los turnos por puesto con sus tarifas base y recargos.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo turno
        </Button>
      </div>

      {/* Tabla */}
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Listado de turnos</CardTitle>
            <CardDescription>
              {filtered.length} {filtered.length === 1 ? "turno" : "turnos"} en la empresa
              seleccionada.
            </CardDescription>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por puesto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              {turnos.length === 0
                ? "Aún no hay turnos registrados."
                : "Ningún turno coincide con la búsqueda."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Puesto</TableHead>
                    <TableHead>Hora Entrada</TableHead>
                    <TableHead>Vigencia</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">HED</TableHead>
                    <TableHead className="text-right">HEDF</TableHead>
                    <TableHead className="text-right">HEN</TableHead>
                    <TableHead className="text-right">HEF</TableHead>
                    <TableHead className="text-right">HN</TableHead>
                    <TableHead className="text-center">Aplica TON</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.puesto || "—"}</TableCell>
                      <TableCell>{fmtTime(t.horaentrada)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {fmtDate(t.fechaini)}
                        </span>
                        <span className="text-muted-foreground"> → </span>
                        {fmtDate(t.fechafin)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.base)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.hed)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.hedf)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.hen)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.hef)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(t.hn)}</TableCell>
                      <TableCell className="text-center">
                        {t.aplicaton ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">
                            Sí
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            No
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEdit(t)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteTarget(t)}
                            aria-label="Eliminar"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog crear/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar turno" : "Nuevo turno"}</DialogTitle>
            <DialogDescription>
              Configura el puesto, vigencia y tarifas. La empresa se aplica automáticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Puesto */}
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="puesto">Puesto *</Label>
              <Input
                id="puesto"
                placeholder="Ej. Operario picking"
                value={form.puesto ?? ""}
                onChange={(e) => updateForm("puesto", e.target.value)}
              />
            </div>

            {/* Hora entrada */}
            <div className="space-y-1.5">
              <Label htmlFor="horaentrada">Hora de entrada</Label>
              <Input
                id="horaentrada"
                type="time"
                value={form.horaentrada ?? ""}
                onChange={(e) => updateForm("horaentrada", e.target.value || null)}
              />
            </div>

            {/* Vigencia */}
            <div className="space-y-1.5">
              <Label htmlFor="fechaini">Fecha inicio</Label>
              <DatePickerField
                id="fechaini"
                value={form.fechaini ?? ""}
                onChange={(value) => updateForm("fechaini", value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fechafin">Fecha fin</Label>
              <DatePickerField
                id="fechafin"
                value={form.fechafin ?? ""}
                onChange={(value) => updateForm("fechafin", value || null)}
              />
            </div>

            {/* Tarifas — agrupadas en su propia "seccion" para que el usuario
                identifique facil el bloque de dinero. */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mt-2 mb-1 text-sm font-semibold text-foreground">
                <DollarSign className="h-4 w-4 text-primary" />
                Tarifas y recargos
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {(
                  [
                    { key: "base", label: "Base" },
                    { key: "hed", label: "HED" },
                    { key: "hedf", label: "HEDF" },
                    { key: "hen", label: "HEN" },
                    { key: "hef", label: "HEF" },
                    { key: "hn", label: "HN" },
                  ] as const
                ).map(({ key, label }) => (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={key}>{label}</Label>
                    <Input
                      id={key}
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0"
                      value={form[key] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value
                        updateForm(key, v === "" ? null : Number(v))
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Toggle aplicaton — separado en su propio bloque para
                resaltar que es una regla de calculo (no una tarifa
                mas). Cuando esta encendido el sistema interpreta que
                las tarifas se liquidan con base en toneladas movidas
                durante el turno. */}
            <div className="md:col-span-2 mt-1">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="aplicaton" className="text-sm font-semibold">
                    Aplica por tonelada
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Activa esta opción si las tarifas del turno se liquidan en función de las
                    toneladas movidas.
                  </p>
                </div>
                <Switch
                  id="aplicaton"
                  checked={!!form.aplicaton}
                  onCheckedChange={(v) => updateForm("aplicaton", v)}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : editingId ? (
                "Actualizar"
              ) : (
                "Crear turno"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmacion eliminar */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este turno?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar el turno <strong>{deleteTarget?.puesto || "Sin puesto"}</strong>. Esta
              acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
