"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { Plus, Edit2, Trash2 } from "lucide-react"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { getCapacitacionesAsistencia, createCapacitacionAsistencia, updateCapacitacionAsistencia, deleteCapacitacionAsistencia, getCapacitaciones, getColaboradores } from "@/lib/rrhh-actions"

export default function CapacitacionesAsistenciaManagement() {
  const [asistencias, setAsistencias] = useState<any[]>([])
  const [capacitaciones, setCapacitaciones] = useState<any[]>([])
  const [colaboradores, setColaboradores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    capacitacion_id: "",
    colaborador_id: "",
    asistio: false,
    resultado: "",
    observaciones: "",
  })
  const { toast } = useToast()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const resAsistencias = await getCapacitacionesAsistencia()
    const resCapacitaciones = await getCapacitaciones()
    const resColaboradores = await getColaboradores()
    if (resAsistencias.success) setAsistencias(resAsistencias.data)
    if (resCapacitaciones.success) setCapacitaciones(resCapacitaciones.data)
    if (resColaboradores.success) setColaboradores(resColaboradores.data)
    setLoading(false)
  }

  const handleSave = async () => {
    if (!formData.capacitacion_id || !formData.colaborador_id) {
      toast({ title: "Error", description: "Completa los campos requeridos", variant: "destructive" })
      return
    }

    if (editingId) {
      const result = await updateCapacitacionAsistencia(editingId, formData)
      if (result.success) {
        toast({ title: "Éxito", description: "Asistencia actualizada" })
        setEditingId(null)
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    } else {
      const result = await createCapacitacionAsistencia(formData)
      if (result.success) {
        toast({ title: "Éxito", description: "Asistencia registrada" })
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    }

    setFormData({
      capacitacion_id: "",
      colaborador_id: "",
      asistio: false,
      resultado: "",
      observaciones: "",
    })
    setOpen(false)
    loadData()
  }

  const handleEdit = (asistencia: any) => {
    setFormData({
      capacitacion_id: asistencia.capacitacion_id,
      colaborador_id: asistencia.colaborador_id,
      asistio: asistencia.asistio,
      resultado: asistencia.resultado || "",
      observaciones: asistencia.observaciones || "",
    })
    setEditingId(asistencia.id)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro?")) return
    const result = await deleteCapacitacionAsistencia(id)
    if (result.success) {
      toast({ title: "Éxito", description: "Asistencia eliminada" })
      loadData()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Asistencia a Capacitaciones</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); setFormData({ capacitacion_id: "", colaborador_id: "", asistio: false, resultado: "", observaciones: "" }) }} className="gap-2">
              <Plus className="w-4 h-4" />
              Registrar Asistencia
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar" : "Registrar"} Asistencia</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Select value={formData.capacitacion_id} onValueChange={(val) => setFormData({ ...formData, capacitacion_id: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Capacitación" />
                </SelectTrigger>
                <SelectContent>
                  {capacitaciones.map((cap) => (
                    <SelectItem key={cap.id} value={cap.id}>
                      {cap.tema} ({cap.fecha})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={formData.colaborador_id} onValueChange={(val) => setFormData({ ...formData, colaborador_id: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Colaborador" />
                </SelectTrigger>
                <SelectContent>
                  {colaboradores.map((col) => (
                    <SelectItem key={col.id} value={col.id}>
                      {col.nombre} {col.apellido}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Checkbox checked={formData.asistio} onCheckedChange={(checked) => setFormData({ ...formData, asistio: checked as boolean })} />
                <label className="text-sm">Asistió</label>
              </div>
              <Input placeholder="Resultado" value={formData.resultado} onChange={(e) => setFormData({ ...formData, resultado: e.target.value })} />
              <Input placeholder="Observaciones" value={formData.observaciones} onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })} />
              <Button onClick={handleSave} className="w-full">Guardar</Button>
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
                <TableHead>Colaborador</TableHead>
                <TableHead>Capacitación</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Asistió</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {asistencias.map((asistencia: any) => (
                <TableRow key={asistencia.id}>
                  <TableCell>{asistencia.colaborador?.nombre} {asistencia.colaborador?.apellido}</TableCell>
                  <TableCell>{asistencia.capacitacion?.tema}</TableCell>
                  <TableCell>{asistencia.capacitacion?.fecha}</TableCell>
                  <TableCell>{asistencia.asistio ? "Sí" : "No"}</TableCell>
                  <TableCell>{asistencia.resultado}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(asistencia)} className="gap-1">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(asistencia.id)} className="gap-1">
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
