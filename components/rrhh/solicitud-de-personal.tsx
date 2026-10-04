"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { useToast } from "@/hooks/use-toast"
import {
  getVacantes,
  createVacante,
  updateVacante,
  deleteVacante,
  getProyectos,
} from "@/lib/rrhh-actions"
import { Plus, Edit2, Trash2 } from "lucide-react"

interface Vacante {
  id: string
  proyecto_id: string
  proyecto?: { nombre: string }
  cargo: string
  headcount: number
  turno: string
  ciudad: string
  rango_salarial_min: number
  rango_salarial_max: number
  requisitos: string
  estado: string
  created_at: string
}

interface Proyecto {
  id: string
  nombre: string
}

export default function SolicitudDePersonal() {
  const [vacantes, setVacantes] = useState<Vacante[]>([])
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    estado: "",
    cargo: "",
    ciudad: "",
    turno: "",
  })
  const [formData, setFormData] = useState({
    proyecto_id: "",
    cargo: "",
    headcount: 1,
    turno: "",
    ciudad: "",
    rango_salarial_min: 0,
    rango_salarial_max: 0,
    requisitos: "",
    estado: "en_revision",
  })
  const { toast } = useToast()

  const loadData = async () => {
    setLoading(true)
    const [vacantesResult, proyectosResult] = await Promise.all([
      getVacantes(filters),
      getProyectos(),
    ])

    if (vacantesResult.success) {
      setVacantes(vacantesResult.data)
    }
    if (proyectosResult.success) {
      setProyectos(proyectosResult.data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.estado, filters.cargo, filters.ciudad, filters.turno])

  const resetForm = () => {
    setFormData({
      proyecto_id: "",
      cargo: "",
      headcount: 1,
      turno: "",
      ciudad: "",
      rango_salarial_min: 0,
      rango_salarial_max: 0,
      requisitos: "",
      estado: "en_revision",
    })
    setEditingId(null)
  }

  const handleSave = async () => {
    if (
      !formData.proyecto_id ||
      !formData.cargo ||
      !formData.turno ||
      !formData.ciudad
    ) {
      toast({ title: "Error", description: "Completa todos los campos" })
      return
    }

    if (editingId) {
      const result = await updateVacante(editingId, formData)
      if (result.success) {
        toast({ title: "Vacante actualizada", description: "Cambios guardados" })
        loadData()
        resetForm()
        setOpen(false)
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al actualizar",
        })
      }
    } else {
      const result = await createVacante(formData)
      if (result.success) {
        toast({ title: "Vacante creada", description: "Nueva vacante agregada" })
        loadData()
        resetForm()
        setOpen(false)
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al crear",
        })
      }
    }
  }

  const handleEdit = (vacante: Vacante) => {
    // Una vez aprobada, la solicitud no se puede editar.
    if (vacante.estado === "aprobado") {
      toast({
        title: "No editable",
        description: "Una solicitud aprobada no se puede editar.",
      })
      return
    }
    setFormData({
      proyecto_id: vacante.proyecto_id,
      cargo: vacante.cargo,
      headcount: vacante.headcount,
      turno: vacante.turno,
      ciudad: vacante.ciudad,
      rango_salarial_min: vacante.rango_salarial_min,
      rango_salarial_max: vacante.rango_salarial_max,
      requisitos: vacante.requisitos,
      estado: vacante.estado,
    })
    setEditingId(vacante.id)
    setOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (confirm("¿Estás seguro de que deseas eliminar esta vacante?")) {
      const result = await deleteVacante(id)
      if (result.success) {
        toast({ title: "Vacante eliminada" })
        loadData()
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al eliminar",
        })
      }
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm()
    }
    setOpen(newOpen)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Solicitud de Personal</h1>
        <p className="text-gray-500">Gestiona vacantes y solicitudes de personal</p>
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg">
        <div>
          <Label htmlFor="filter-estado">Estado</Label>
          <select
            id="filter-estado"
            value={filters.estado}
            onChange={(e) => setFilters({ ...filters, estado: e.target.value })}
            className="w-full px-3 py-2 border rounded-md text-sm"
          >
            <option value="">Todos</option>
            <option value="en_revision">En revisión</option>
            <option value="aprobado">Aprobado</option>
            <option value="rechazado">Rechazado</option>
          </select>
        </div>
        <div>
          <Label htmlFor="filter-cargo">Cargo</Label>
          <Input
            id="filter-cargo"
            placeholder="Filtrar cargo..."
            value={filters.cargo}
            onChange={(e) => setFilters({ ...filters, cargo: e.target.value })}
            className="text-sm"
          />
        </div>
        <div>
          <Label htmlFor="filter-ciudad">Ciudad</Label>
          <Input
            id="filter-ciudad"
            placeholder="Filtrar ciudad..."
            value={filters.ciudad}
            onChange={(e) => setFilters({ ...filters, ciudad: e.target.value })}
            className="text-sm"
          />
        </div>
        <div>
          <Label htmlFor="filter-turno">Turno</Label>
          <select
            id="filter-turno"
            value={filters.turno}
            onChange={(e) => setFilters({ ...filters, turno: e.target.value })}
            className="w-full px-3 py-2 border rounded-md text-sm"
          >
            <option value="">Todos</option>
            <option value="diurno">Diurno</option>
            <option value="nocturno">Nocturno</option>
            <option value="mixto">Mixto</option>
          </select>
        </div>
      </div>

      {/* Botón Nueva Vacante */}
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Nueva Vacante
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Editar Vacante" : "Nueva Vacante"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="proyecto">Proyecto*</Label>
                  <select
                    id="proyecto"
                    value={formData.proyecto_id}
                    onChange={(e) =>
                      setFormData({ ...formData, proyecto_id: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="">Selecciona un proyecto</option>
                    {proyectos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="cargo">Cargo/Título*</Label>
                  <Input
                    id="cargo"
                    value={formData.cargo}
                    onChange={(e) =>
                      setFormData({ ...formData, cargo: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="headcount">Headcount*</Label>
                  <Input
                    id="headcount"
                    type="number"
                    value={formData.headcount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        headcount: parseInt(e.target.value),
                      })
                    }
                    min="1"
                  />
                </div>
                <div>
                  <Label htmlFor="turno">Turno*</Label>
                  <select
                    id="turno"
                    value={formData.turno}
                    onChange={(e) =>
                      setFormData({ ...formData, turno: e.target.value })
                    }
                    className="w-full px-3 py-2 border rounded-md"
                  >
                    <option value="">Selecciona turno</option>
                    <option value="diurno">Diurno</option>
                    <option value="nocturno">Nocturno</option>
                    <option value="mixto">Mixto</option>
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="ciudad">Ciudad*</Label>
                <Input
                  id="ciudad"
                  value={formData.ciudad}
                  onChange={(e) =>
                    setFormData({ ...formData, ciudad: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rango_min">Rango Salarial Mínimo</Label>
                  <Input
                    id="rango_min"
                    type="number"
                    value={formData.rango_salarial_min}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        rango_salarial_min: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="rango_max">Rango Salarial Máximo</Label>
                  <Input
                    id="rango_max"
                    type="number"
                    value={formData.rango_salarial_max}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        rango_salarial_max: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="requisitos">Requisitos</Label>
                <textarea
                  id="requisitos"
                  value={formData.requisitos}
                  onChange={(e) =>
                    setFormData({ ...formData, requisitos: e.target.value })
                  }
                  className="w-full px-3 py-2 border rounded-md h-24"
                  placeholder="Describe los requisitos para la vacante..."
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  Cancelar
                </Button>
                <Button onClick={handleSave}>
                  {editingId ? "Actualizar" : "Crear"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Tabla de Vacantes */}
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Proyecto</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>HC</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Ciudad</TableHead>
              <TableHead>Rango Salarial</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-32">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-4">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : vacantes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-4 text-gray-500">
                  No hay vacantes
                </TableCell>
              </TableRow>
            ) : (
              vacantes.map((vacante) => (
                <TableRow key={vacante.id}>
                  <TableCell className="font-medium">
                    {proyectos.find((p) => p.id === vacante.proyecto_id)
                      ?.nombre || "-"}
                  </TableCell>
                  <TableCell>{vacante.cargo}</TableCell>
                  <TableCell>{vacante.headcount}</TableCell>
                  <TableCell>
                    <span className="capitalize">{vacante.turno}</span>
                  </TableCell>
                  <TableCell>{vacante.ciudad}</TableCell>
                  <TableCell>
                    ${vacante.rango_salarial_min.toLocaleString()} - $
                    {vacante.rango_salarial_max.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        vacante.estado === "aprobado"
                          ? "bg-green-100 text-green-800"
                          : vacante.estado === "rechazado"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {vacante.estado === "aprobado"
                        ? "Aprobado"
                        : vacante.estado === "rechazado"
                          ? "Rechazado"
                          : "En revisión"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {/* La edicion se bloquea cuando la solicitud ya esta
                          aprobada. La aprobacion se hace desde el modulo
                          "Aprobación de Solicitudes de Personal". */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(vacante)}
                        disabled={vacante.estado === "aprobado"}
                        title={
                          vacante.estado === "aprobado"
                            ? "Una solicitud aprobada no se puede editar"
                            : "Editar"
                        }
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(vacante.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
