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
import { getContratos, createContrato, updateContrato, deleteContrato, getColaboradores } from "@/lib/rrhh-actions"
import { useAuth } from "@/components/auth-provider"

export default function ContratosManagement() {
  const { selectedEmpresaId } = useAuth()
  const [contratos, setContratos] = useState<any[]>([])
  const [colaboradores, setColaboradores] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    colaborador_id: "",
    fecha_inicio: "",
    fecha_fin: "",
    tipo_contrato: "indefinido",
    cargo: "",
    salario_base: "",
    cliente_asignado: "",
    sede: "",
    estado: "activo",
  })
  const { toast } = useToast()

  useEffect(() => {
    if (selectedEmpresaId) {
      loadData()
    }
  }, [selectedEmpresaId])

  const loadData = async () => {
    setLoading(true)
    const resContratos = await getContratos(selectedEmpresaId)
    const resColaboradores = await getColaboradores()
    if (resContratos.success) setContratos(resContratos.data)
    if (resColaboradores.success) setColaboradores(resColaboradores.data)
    setLoading(false)
  }

  const handleSave = async () => {
    // Validate: No new contracts on Sundays
    if (!editingId) {
      const today = new Date()
      const colombiaTime = new Date(today.toLocaleString("en-US", { timeZone: "America/Bogota" }))
      if (colombiaTime.getDay() === 0) {
        toast({ title: "Error", description: "No se pueden crear nuevos contratos los domingos", variant: "destructive" })
        return
      }
    }

    if (!formData.colaborador_id || !formData.fecha_inicio) {
      toast({ title: "Error", description: "Completa los campos requeridos", variant: "destructive" })
      return
    }

    const data = {
      ...formData,
      salario_base: parseFloat(formData.salario_base),
    }

    if (editingId) {
      const result = await updateContrato(editingId, data)
      if (result.success) {
        toast({ title: "Éxito", description: "Contrato actualizado" })
        setEditingId(null)
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    } else {
      const result = await createContrato(data)
      if (result.success) {
        toast({ title: "Éxito", description: "Contrato creado" })
      } else {
        toast({ title: "Error", description: result.message, variant: "destructive" })
      }
    }

    setFormData({
      colaborador_id: "",
      fecha_inicio: "",
      fecha_fin: "",
      tipo_contrato: "indefinido",
      cargo: "",
      salario_base: "",
      cliente_asignado: "",
      sede: "",
      estado: "activo",
    })
    setOpen(false)
    loadData()
  }

  const handleEdit = (contrato: any) => {
    setFormData({
      colaborador_id: contrato.colaborador_id,
      fecha_inicio: contrato.fecha_inicio,
      fecha_fin: contrato.fecha_fin || "",
      tipo_contrato: contrato.tipo_contrato,
      cargo: contrato.cargo,
      salario_base: contrato.salario_base.toString(),
      cliente_asignado: contrato.cliente_asignado || "",
      sede: contrato.sede || "",
      estado: contrato.estado,
    })
    setEditingId(contrato.id)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro?")) return
    const result = await deleteContrato(id)
    if (result.success) {
      toast({ title: "Éxito", description: "Contrato eliminado" })
      loadData()
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Gestión de Contratos</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { setEditingId(null); setFormData({ colaborador_id: "", fecha_inicio: "", fecha_fin: "", tipo_contrato: "indefinido", cargo: "", salario_base: "", cliente_asignado: "", sede: "", estado: "activo" }) }} className="gap-2">
              <Plus className="w-4 h-4" />
              Nuevo Contrato
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar" : "Nuevo"} Contrato</DialogTitle>
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
              <DatePickerField value={formData.fecha_inicio} onChange={(value) => setFormData({ ...formData, fecha_inicio: value })} />
              <DatePickerField value={formData.fecha_fin} onChange={(value) => setFormData({ ...formData, fecha_fin: value })} placeholder="Fecha fin (opcional)" />
              <Select value={formData.tipo_contrato} onValueChange={(val) => setFormData({ ...formData, tipo_contrato: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="indefinido">Indefinido</SelectItem>
                  <SelectItem value="fijo">Fijo</SelectItem>
                  <SelectItem value="temporal">Temporal</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Cargo" value={formData.cargo} onChange={(e) => setFormData({ ...formData, cargo: e.target.value })} />
              <Input placeholder="Salario Base" type="number" value={formData.salario_base} onChange={(e) => setFormData({ ...formData, salario_base: e.target.value })} />
              <Input placeholder="Cliente Asignado" value={formData.cliente_asignado} onChange={(e) => setFormData({ ...formData, cliente_asignado: e.target.value })} />
              <Input placeholder="Sede" value={formData.sede} onChange={(e) => setFormData({ ...formData, sede: e.target.value })} />
              <Select value={formData.estado} onValueChange={(val) => setFormData({ ...formData, estado: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="inactivo">Inactivo</SelectItem>
                </SelectContent>
              </Select>
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
                <TableHead>Cargo</TableHead>
                <TableHead>Fecha Inicio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contratos.map((contrato: any) => (
                <TableRow key={contrato.id}>
                  <TableCell>{contrato.colaboradores?.nombre} {contrato.colaboradores?.apellido}</TableCell>
                  <TableCell>{contrato.cargo}</TableCell>
                  <TableCell>{contrato.fecha_inicio}</TableCell>
                  <TableCell>{contrato.tipo_contrato}</TableCell>
                  <TableCell>{contrato.estado}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(contrato)} className="gap-1">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(contrato.id)} className="gap-1">
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
