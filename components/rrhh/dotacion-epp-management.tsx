"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
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
import { getDotacionEPP, createDotacionEPP, updateDotacionEPP, deleteDotacionEPP, getColaboradores } from "@/lib/rrhh-actions"

export default function DotacionEPPManagement() {
  const [dotaciones, setDotaciones] = useState<any[]>([])
  const [colaboradores, setColaboradores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    colaborador_id: "",
    fecha_entrega: "",
    tipo_item: "",
    item: "",
    talla: "",
    cantidad: "1",
    estado: "entregado",
    observaciones: "",
  })
  const { toast } = useToast()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const resDotaciones = await getDotacionEPP()
    const resColaboradores = await getColaboradores()
    if (resDotaciones.success) setDotaciones(resDotaciones.data)
    if (resColaboradores.success) setColaboradores(resColaboradores.data)
    setLoading(false)
  }

  const handleSave = async () => {
    if (!formData.colaborador_id || !formData.fecha_entrega || !formData.item) {
      toast({ title: "Error", description: "Completa los campos requeridos", variant: "destructive" })
      return
    }

    const data = {
      ...formData,
      cantidad: parseInt(formData.cantidad),
    }

    if (editingId) {
      const result = await updateDotacionEPP(editingId, data)
      if (result.success) {
        toast({ title: "Éxito", description: "Dotación actualizada" })
        setEditingId(null)
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    } else {
      const result = await createDotacionEPP(data)
      if (result.success) {
        toast({ title: "Éxito", description: "Dotación registrada" })
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    }

    setFormData({
      colaborador_id: "",
      fecha_entrega: "",
      tipo_item: "",
      item: "",
      talla: "",
      cantidad: "1",
      estado: "entregado",
      observaciones: "",
    })
    setOpen(false)
    loadData()
  }

  const handleEdit = (dotacion: any) => {
    setFormData({
      colaborador_id: dotacion.colaborador_id,
      fecha_entrega: dotacion.fecha_entrega,
      tipo_item: dotacion.tipo_item,
      item: dotacion.item,
      talla: dotacion.talla || "",
      cantidad: dotacion.cantidad.toString(),
      estado: dotacion.estado,
      observaciones: dotacion.observaciones || "",
    })
    setEditingId(dotacion.id)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro?")) return
    const result = await deleteDotacionEPP(id)
    if (result.success) {
      toast({ title: "Éxito", description: "Dotación eliminada" })
      loadData()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Gestión de Dotación EPP</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); setFormData({ colaborador_id: "", fecha_entrega: "", tipo_item: "", item: "", talla: "", cantidad: "1", estado: "entregado", observaciones: "" }) }} className="gap-2">
              <Plus className="w-4 h-4" />
              Nueva Dotación
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar" : "Nueva"} Dotación EPP</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 grid grid-cols-2 gap-4">
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
              <DatePickerField value={formData.fecha_entrega} onChange={(value) => setFormData({ ...formData, fecha_entrega: value })} />
              <Input placeholder="Tipo de Item" value={formData.tipo_item} onChange={(e) => setFormData({ ...formData, tipo_item: e.target.value })} />
              <Input placeholder="Item" value={formData.item} onChange={(e) => setFormData({ ...formData, item: e.target.value })} />
              <Input placeholder="Talla" value={formData.talla} onChange={(e) => setFormData({ ...formData, talla: e.target.value })} />
              <Input type="number" placeholder="Cantidad" value={formData.cantidad} onChange={(e) => setFormData({ ...formData, cantidad: e.target.value })} />
              <Select value={formData.estado} onValueChange={(val) => setFormData({ ...formData, estado: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entregado">Entregado</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="devuelto">Devuelto</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Observaciones" value={formData.observaciones} onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })} className="col-span-2" />
              <Button onClick={handleSave} className="col-span-2">Guardar</Button>
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
                <TableHead>Item</TableHead>
                <TableHead>Talla</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead>Fecha Entrega</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dotaciones.map((dot: any) => (
                <TableRow key={dot.id}>
                  <TableCell>{dot.colaboradores?.nombre} {dot.colaboradores?.apellido}</TableCell>
                  <TableCell>{dot.item}</TableCell>
                  <TableCell>{dot.talla}</TableCell>
                  <TableCell>{dot.cantidad}</TableCell>
                  <TableCell>{dot.fecha_entrega}</TableCell>
                  <TableCell>{dot.estado}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(dot)} className="gap-1">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(dot.id)} className="gap-1">
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
