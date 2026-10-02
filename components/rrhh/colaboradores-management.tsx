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
import { getColaboradores, createColaborador, updateColaborador, deleteColaborador } from "@/lib/rrhh-actions"

export default function ColaboradoresManagement() {
  const [colaboradores, setColaboradores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    nombre: "",
    apellido: "",
    cedula: "",
    email: "",
    telefono: "",
  })
  const { toast } = useToast()

  const loadColaboradores = async () => {
    setLoading(true)
    const result = await getColaboradores()
    if (result.success) {
      setColaboradores(result.data)
    } else {
      toast({ title: "Error", description: "No se pudieron cargar los colaboradores", variant: "destructive" })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadColaboradores()
  }, [])

  const handleSave = async () => {
    if (!formData.nombre || !formData.apellido || !formData.cedula) {
      toast({ title: "Error", description: "Completa los campos requeridos", variant: "destructive" })
      return
    }

    if (editingId) {
      const result = await updateColaborador(editingId, formData)
      if (result.success) {
        toast({ title: "Éxito", description: "Colaborador actualizado" })
        setEditingId(null)
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    } else {
      const result = await createColaborador(formData)
      if (result.success) {
        toast({ title: "Éxito", description: "Colaborador creado" })
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    }

    setFormData({ nombre: "", apellido: "", cedula: "", email: "", telefono: "" })
    setOpen(false)
    loadColaboradores()
  }

  const handleEdit = (colaborador: any) => {
    setFormData(colaborador)
    setEditingId(colaborador.id)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro?")) return
    const result = await deleteColaborador(id)
    if (result.success) {
      toast({ title: "Éxito", description: "Colaborador eliminado" })
      loadColaboradores()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Gestión de Colaboradores</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); setFormData({ nombre: "", apellido: "", cedula: "", email: "", telefono: "" }) }} className="gap-2">
              <Plus className="w-4 h-4" />
              Nuevo Colaborador
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar" : "Nuevo"} Colaborador</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                placeholder="Nombre"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
              <Input
                placeholder="Apellido"
                value={formData.apellido}
                onChange={(e) => setFormData({ ...formData, apellido: e.target.value })}
              />
              <Input
                placeholder="Cédula"
                value={formData.cedula}
                onChange={(e) => setFormData({ ...formData, cedula: e.target.value })}
              />
              <Input
                placeholder="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
              <Input
                placeholder="Teléfono"
                value={formData.telefono}
                onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
              />
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
                <TableHead>Nombre</TableHead>
                <TableHead>Apellido</TableHead>
                <TableHead>Cédula</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {colaboradores.map((col) => (
                <TableRow key={col.id}>
                  <TableCell>{col.nombre}</TableCell>
                  <TableCell>{col.apellido}</TableCell>
                  <TableCell>{col.cedula}</TableCell>
                  <TableCell>{col.email}</TableCell>
                  <TableCell>{col.telefono}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleEdit(col)}
                      className="gap-1"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(col.id)}
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
