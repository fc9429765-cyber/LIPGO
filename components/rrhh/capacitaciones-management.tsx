"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { Plus, Edit2, Trash2, Upload, FileText, Loader2, ExternalLink } from "lucide-react"
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  getCapacitaciones,
  createCapacitacion,
  updateCapacitacion,
  deleteCapacitacion,
} from "@/lib/rrhh-actions"

// Estado vacio reutilizado al abrir/cerrar el dialogo. Ahora incluye:
// - fecha_fin: rango de fin de la capacitacion (mapea a `fecha_fin` date)
// - urlcapacitacion: URL publica de la evidencia subida al bucket
//   `archivos` carpeta `capacitaciones`
const EMPTY_FORM = {
  tema: "",
  categoria: "",
  fecha: "",
  fecha_fin: "",
  duracion_horas: "",
  instructor: "",
  cliente_aplica: "",
  sede: "",
  urlcapacitacion: "",
}

export default function CapacitacionesManagement() {
  const [capacitaciones, setCapacitaciones] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()

  // Recargamos las capacitaciones cada vez que cambia la empresa
  // seleccionada para que la tabla solo muestre las de esa empresa.
  useEffect(() => {
    loadCapacitaciones()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  const loadCapacitaciones = async () => {
    setLoading(true)
    const result = await getCapacitaciones(selectedEmpresaId)
    if (result.success) setCapacitaciones(result.data)
    setLoading(false)
  }

  // Sube el archivo seleccionado al bucket `archivos/capacitaciones/`
  // mediante el endpoint /api/capacitaciones/upload-evidencia y guarda
  // la URL resultante en formData.urlcapacitacion. La URL se persiste
  // al guardar la capacitacion (insert/update).
  const handleUploadEvidencia = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/capacitaciones/upload-evidencia", {
        method: "POST",
        body: fd,
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        toast({
          title: "Error",
          description: json?.error || "No se pudo subir la evidencia",
          variant: "destructive",
        })
        return
      }
      setFormData((prev) => ({ ...prev, urlcapacitacion: json.url }))
      toast({ title: "Evidencia subida", description: "Archivo cargado correctamente" })
    } catch (err: any) {
      toast({
        title: "Error",
        description: err?.message || "Error inesperado",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const handleSave = async () => {
    if (!formData.tema || !formData.fecha) {
      toast({
        title: "Error",
        description: "Completa los campos requeridos",
        variant: "destructive",
      })
      return
    }

    // Mapeo a las columnas reales. `fecha_fin` y `urlcapacitacion` se
    // envian como null cuando estan vacios para no chocar con tipos
    // date/text con NOT NULL deshabilitado en la tabla.
    const data: Record<string, any> = {
      tema: formData.tema,
      categoria: formData.categoria || null,
      fecha: formData.fecha,
      fecha_fin: formData.fecha_fin || null,
      duracion_horas: formData.duracion_horas
        ? parseFloat(formData.duracion_horas)
        : null,
      instructor: formData.instructor || null,
      cliente_aplica: formData.cliente_aplica || null,
      sede: formData.sede || null,
      urlcapacitacion: formData.urlcapacitacion || null,
    }

    if (editingId) {
      const result = await updateCapacitacion(editingId, data)
      if (result.success) {
        toast({ title: "Éxito", description: "Capacitación actualizada" })
        setEditingId(null)
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    } else {
      const result = await createCapacitacion(data, selectedEmpresaId)
      if (result.success) {
        toast({ title: "Éxito", description: "Capacitación creada" })
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    }

    setFormData(EMPTY_FORM)
    setOpen(false)
    loadCapacitaciones()
  }

  const handleEdit = (cap: any) => {
    setFormData({
      tema: cap.tema || "",
      categoria: cap.categoria || "",
      fecha: cap.fecha || "",
      fecha_fin: cap.fecha_fin || "",
      duracion_horas:
        cap.duracion_horas != null ? String(cap.duracion_horas) : "",
      instructor: cap.instructor || "",
      cliente_aplica: cap.cliente_aplica || "",
      sede: cap.sede || "",
      urlcapacitacion: cap.urlcapacitacion || "",
    })
    setEditingId(cap.id)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro?")) return
    const result = await deleteCapacitacion(id)
    if (result.success) {
      toast({ title: "Éxito", description: "Capacitación eliminada" })
      loadCapacitaciones()
    } else {
      toast({
        title: "Error",
        description: result.message,
        variant: "destructive",
      })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Gestión de Capacitaciones</h1>
        <Dialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o)
            if (!o) {
              setEditingId(null)
              setFormData(EMPTY_FORM)
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                setEditingId(null)
                setFormData(EMPTY_FORM)
              }}
              className="gap-2"
            >
              <Plus className="w-4 h-4" />
              Nueva Capacitación
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar" : "Nueva"} Capacitación</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="cap-tema">Tema *</Label>
                <Input
                  id="cap-tema"
                  placeholder="Tema de la capacitación"
                  value={formData.tema}
                  onChange={(e) => setFormData({ ...formData, tema: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cap-categoria">Categoría</Label>
                <Input
                  id="cap-categoria"
                  placeholder="Categoría"
                  value={formData.categoria}
                  onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cap-duracion">Duración (horas)</Label>
                <Input
                  id="cap-duracion"
                  type="number"
                  placeholder="Ej. 2"
                  value={formData.duracion_horas}
                  onChange={(e) =>
                    setFormData({ ...formData, duracion_horas: e.target.value })
                  }
                  step="0.5"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cap-fecha">Fecha inicio *</Label>
                <DatePickerField
                  id="cap-fecha"
                  value={formData.fecha}
                  onChange={(value) => setFormData({ ...formData, fecha: value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cap-fecha-fin">Fecha fin</Label>
                <DatePickerField
                  id="cap-fecha-fin"
                  value={formData.fecha_fin}
                  onChange={(value) =>
                    setFormData({ ...formData, fecha_fin: value })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cap-instructor">Instructor</Label>
                <Input
                  id="cap-instructor"
                  placeholder="Instructor"
                  value={formData.instructor}
                  onChange={(e) => setFormData({ ...formData, instructor: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cap-cliente">Cliente aplica</Label>
                <Input
                  id="cap-cliente"
                  placeholder="Cliente aplica"
                  value={formData.cliente_aplica}
                  onChange={(e) =>
                    setFormData({ ...formData, cliente_aplica: e.target.value })
                  }
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="cap-empresa">Empresa</Label>
                <Input
                  id="cap-empresa"
                  value={selectedEmpresaNombre || "Sin empresa seleccionada"}
                  disabled
                  readOnly
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>Evidencia (archivo o imagen)</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleUploadEvidencia(f)
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="gap-2"
                  >
                    {uploading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {formData.urlcapacitacion ? "Reemplazar evidencia" : "Subir evidencia"}
                  </Button>
                  {formData.urlcapacitacion && (
                    <a
                      href={formData.urlcapacitacion}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <FileText className="w-4 h-4" />
                      Ver archivo
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>

              <Button onClick={handleSave} className="col-span-2" disabled={uploading}>
                Guardar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead>Tema</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Fecha inicio</TableHead>
                <TableHead>Fecha fin</TableHead>
                <TableHead>Duración (h)</TableHead>
                <TableHead>Instructor</TableHead>
                <TableHead>Evidencia</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {capacitaciones.map((cap) => (
                <TableRow key={cap.id}>
                  <TableCell>{cap.tema}</TableCell>
                  <TableCell>{selectedEmpresaNombre || "—"}</TableCell>
                  <TableCell>{cap.categoria}</TableCell>
                  <TableCell>{cap.fecha}</TableCell>
                  <TableCell>{cap.fecha_fin || "—"}</TableCell>
                  <TableCell>{cap.duracion_horas}</TableCell>
                  <TableCell>{cap.instructor}</TableCell>
                  <TableCell>
                    {cap.urlcapacitacion ? (
                      <a
                        href={cap.urlcapacitacion}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                      >
                        <FileText className="w-4 h-4" />
                        Ver
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(cap)}
                      className="gap-1"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(cap.id)}
                      className="gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
