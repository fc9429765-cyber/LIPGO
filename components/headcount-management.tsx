"use client"

import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import type { HeadcountPerson } from "@/lib/headcount-actions"
import { Upload, Trash2, Eye, Plus, Edit, ShieldCheck, ArrowRight, Users, Briefcase, Search } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { CARGOS_HEADCOUNT } from "@/lib/headcount-cargos"
import { CODIGOS_AFP, CODIGOS_EPS } from "@/lib/pila-codigos-oficiales"

// Listado fijo de cargos para Headcount. Vive en lib/headcount-cargos.ts
// porque los server actions que sincronizan desde otros modulos tambien lo
// necesitan: es la lista que decide que valor puede quedar en `cargo`.
const CARGOS_OPTIONS = CARGOS_HEADCOUNT

const DOCUMENT_FIELDS = [
  { key: "hoja_de_vida", label: "Hoja de Vida" },
  { key: "copia_doc_id", label: "Copia Doc. ID" },
  { key: "afiliacion_arl", label: "Afiliación ARL" },
  { key: "afiliacion_eps", label: "Afiliación EPS" },
  { key: "afiliacion_afp", label: "Afiliación AFP" },
  { key: "afiliacion_caja", label: "Afiliación Caja" },
  { key: "cert_laborales", label: "Cert. Laborales" },
  { key: "cert_personales", label: "Cert. Personales" },
  { key: "antecedentes", label: "Antecedentes" },
  { key: "doc_beneficia", label: "Doc. Beneficiarios" },
  { key: "examenes_ing", label: "Exámenes Ingreso" },
  { key: "cert_m_alimentos", label: "Cert. M. Alimentos" },
  { key: "cert_eva_med", label: "Cert. Eva. Médica" },
  { key: "acta_dotacion", label: "Acta Dotación" },
  { key: "cert_cuenta", label: "Cert. Cuenta" },
  { key: "contrato", label: "Contrato" },
  { key: "sst", label: "SST" },
  { key: "induccion", label: "Inducción" },
]

interface HeadcountManagementProps {
  /** Salto desde el buscador global (Ctrl+K › Registros): abre ya filtrado por
   *  cédula, en la pestaña (operativo/administrativo) donde está la persona. */
  initialSearch?: { identificacion: string; tab?: "operativo" | "administrativo" } | null
  onInitialSearchApplied?: () => void
}

export default function HeadcountManagement({ initialSearch, onInitialSearchApplied }: HeadcountManagementProps = {}) {
  const { selectedEmpresaId } = useAuth()
  // Pestaña activa: "operativo" o "administrativo". Las DOS filtran por el
  // proyecto seleccionado: el administrativo tambien pertenece a un proyecto.
  const [activeTab, setActiveTab] = useState<"operativo" | "administrativo">("operativo")
  const [people, setPeople] = useState<HeadcountPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selectedPerson, setSelectedPerson] = useState<HeadcountPerson | null>(null)
  const [contactDialogOpen, setContactDialogOpen] = useState(false)
  const [contactPerson, setContactPerson] = useState<HeadcountPerson | null>(null)
  const [formData, setFormData] = useState({
    identificacion: "",
    nombre: "",
    contratosiigo: "",
    correo: "",
    celular: "",
    fechainicio: "",
    fecha_retiro: "",
    salario: "",
    cargo: "",
    // `aplicaplano` se persiste como boolean en la columna del mismo
    // nombre en la tabla `headcount`. Por defecto false al crear.
    aplicaplano: false,
    // Marca de personal administrativo (columna `admin`).
    admin: false,
    // Datos de Seguridad Social (PILA) -- capturados aquí, al contratar,
    // en vez de en una ficha aparte que nadie llenaba (ver
    // scripts/170_add_pila_fields_headcount.sql). Los lee el exportador PILA.
    ciudad: "",
    administradora_pension: "",
    administradora_salud: "",
    administradora_caja: "",
    tipo_cotizante: "",
    subtipo_cotizante: "",
    centro_trabajo: "",
    actividad_economica: "",
  })
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [statusPassword, setStatusPassword] = useState("")
  const [newStatus, setNewStatus] = useState("")
  const [personToChangeStatus, setPersonToChangeStatus] = useState<HeadcountPerson | null>(null)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [transferCompanies, setTransferCompanies] = useState<{ id: number; nombre: string }[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("")
  const [personToTransfer, setPersonToTransfer] = useState<HeadcountPerson | null>(null)
  // Administrativos que quedaron sin proyecto. Se listan en todos los proyectos
  // --si se ocultaran, desaparecerian sin que nadie lo note-- y se avisa para
  // que alguien los asigne.
  const sinProyecto = useMemo(
    () => people.filter((p) => p.idempresa == null).length,
    [people],
  )
  const [transferLoading, setTransferLoading] = useState(false)
  // Búsqueda por identificación y filtro por estado.
  const [searchId, setSearchId] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("todos")
  const { toast } = useToast()

  // Listado visible aplicando búsqueda por identificación y filtro por estado.
  const filteredPeople = people.filter((person) => {
    const matchesId = searchId.trim()
      ? person.identificacion?.toLowerCase().includes(searchId.trim().toLowerCase())
      : true
    const matchesStatus = statusFilter === "todos" ? true : person.estado === statusFilter
    return matchesId && matchesStatus
  })

  useEffect(() => {
    // La pestaña administrativa no depende de la empresa seleccionada.
    if (selectedEmpresaId) {
      loadPeople()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId, activeTab])

  // Filtro inicial del buscador global: se aplica una vez (pestaña, estado
  // "todos" para que aparezca aunque esté retirada, y cédula) y se avisa al
  // padre para que lo limpie.
  useEffect(() => {
    if (!initialSearch?.identificacion) return
    if (initialSearch.tab) setActiveTab(initialSearch.tab)
    setStatusFilter("todos")
    setSearchId(initialSearch.identificacion)
    onInitialSearchApplied?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSearch])

  const loadTransferCompanies = async () => {
    try {
      const response = await fetch("/api/empresas", {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("Failed to fetch companies")
      const json = await response.json()
      const companies = json.data || json
      setTransferCompanies(companies)
    } catch (error) {
      console.error("[v0] Error loading companies:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar la lista de empresas",
        variant: "destructive",
      })
    }
  }

  const loadPeople = async () => {
    try {
      setLoading(true)
      // Las dos pestañas van contra el proyecto activo; `admin=true` solo
      // decide si se listan los administrativos o los operativos.
      const url =
        activeTab === "administrativo"
          ? `/api/headcount?admin=true&empresaId=${selectedEmpresaId}`
          : `/api/headcount?empresaId=${selectedEmpresaId}`
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
      })
      if (!response.ok) throw new Error("Failed to fetch")
      const data = await response.json()
      setPeople(data)
    } catch (error) {
      console.error("[v0] Error loading people:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar la lista de personal",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setSelectedPerson(null)
    setFormData({
      identificacion: "",
      nombre: "",
      contratosiigo: "",
      correo: "",
      celular: "",
      fechainicio: "",
      fecha_retiro: "",
      salario: "",
      cargo: "",
      aplicaplano: false,
      // En la pestaña administrativa, todo nuevo registro queda como admin=true.
      admin: activeTab === "administrativo",
      ciudad: "",
      administradora_pension: "",
      administradora_salud: "",
      administradora_caja: "",
      tipo_cotizante: "",
      subtipo_cotizante: "",
      centro_trabajo: "",
      actividad_economica: "",
    })
  }

  const handleSave = async () => {
    try {
      console.log("[v0] Saving person:", formData)

      if (!formData.identificacion || !formData.nombre) {
        toast({
          title: "Error",
          description: "Identificación y nombre son requeridos",
          variant: "destructive",
        })
        return
      }

      if (selectedPerson) {
        const response = await fetch(`/api/headcount/${selectedPerson.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        })

        if (!response.ok) throw new Error("Failed to update")

        toast({ title: "Éxito", description: "Persona actualizada correctamente" })
  } else {
  const response = await fetch("/api/headcount", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...formData, empresaId: selectedEmpresaId }),
  })

        if (!response.ok) {
          const errorData = await response.json()
          console.error("[v0] Error response:", errorData)
          throw new Error("Failed to create")
        }

        toast({ title: "Éxito", description: "Persona registrada correctamente" })
      }

      setDialogOpen(false)
      resetForm()
      loadPeople()
    } catch (error) {
      console.error("[v0] Error saving person:", error)
      toast({
        title: "Error",
        description: "No se pudo guardar el registro",
        variant: "destructive",
      })
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm("¿Está seguro de eliminar este registro?")) return

    try {
      const response = await fetch(`/api/headcount/${id}`, {
        method: "DELETE",
      })

      if (!response.ok) throw new Error("Failed to delete")

      toast({ title: "Éxito", description: "Persona eliminada correctamente" })
      loadPeople()
    } catch (error) {
      console.error("[v0] Error deleting person:", error)
      toast({
        title: "Error",
        description: "No se pudo eliminar el registro",
        variant: "destructive",
      })
    }
  }

  const handleFileUpload = async (file: File, person: HeadcountPerson, documentType: string) => {
    try {
      setUploading(true)
      console.log("[v0] Uploading file:", { personId: person.id, documentType })

      const formData = new FormData()
      formData.append("file", file)
      formData.append("personId", person.id!.toString())
      formData.append("documentType", documentType)

      const response = await fetch("/api/headcount/upload-document", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) throw new Error("Failed to upload")

      toast({ title: "Éxito", description: "Documento cargado correctamente" })
      loadPeople()
    } catch (error) {
      console.error("[v0] Error uploading file:", error)
      toast({
        title: "Error",
        description: "No se pudo cargar el documento",
        variant: "destructive",
      })
    } finally {
      setUploading(false)
    }
  }

  const openTransferDialog = (person: HeadcountPerson) => {
    setPersonToTransfer(person)
    setSelectedCompanyId("")
    loadTransferCompanies()
    setTransferDialogOpen(true)
  }

  const handleTransfer = async () => {
    try {
      if (!personToTransfer || !selectedCompanyId) {
        toast({
          title: "Error",
          description: "Debe seleccionar una empresa",
          variant: "destructive",
        })
        return
      }

      setTransferLoading(true)
      const response = await fetch(`/api/headcount/${personToTransfer.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempresa: parseInt(selectedCompanyId),
        }),
      })

      if (!response.ok) throw new Error("Failed to transfer person")

      toast({
        title: "Éxito",
        description: `${personToTransfer.nombre} ha sido trasladado exitosamente`,
      })

      setTransferDialogOpen(false)
      setPersonToTransfer(null)
      setSelectedCompanyId("")
      await loadPeople()
    } catch (error) {
      console.error("[v0] Error transferring person:", error)
      toast({
        title: "Error",
        description: "Error al trasladar la persona",
        variant: "destructive",
      })
    } finally {
      setTransferLoading(false)
    }
  }

  const openEditDialog = (person: HeadcountPerson) => {
    setSelectedPerson(person)
    setFormData({
      identificacion: person.identificacion,
      nombre: person.nombre,
      contratosiigo: person.contratosiigo || "",
      correo: person.correo || "",
      celular: person.celular || "",
      fechainicio: person.fechainicio || "",
      fecha_retiro: person.fecha_retiro || "",
      salario: person.salario?.toString() || "",
      cargo: person.cargo || "",
      // null/undefined -> false en UI: el checkbox no soporta tristate.
      aplicaplano: !!person.aplicaplano,
      admin: !!person.admin,
      ciudad: person.ciudad || "",
      administradora_pension: person.administradora_pension || "",
      administradora_salud: person.administradora_salud || "",
      administradora_caja: person.administradora_caja || "",
      tipo_cotizante: person.tipo_cotizante || "",
      subtipo_cotizante: person.subtipo_cotizante || "",
      centro_trabajo: person.centro_trabajo || "",
      actividad_economica: person.actividad_economica || "",
    })
    setDialogOpen(true)
  }

  const openContactDialog = (person: HeadcountPerson) => {
    setContactPerson(person)
    setContactDialogOpen(true)
  }

  const openStatusChangeDialog = (person: HeadcountPerson) => {
    setPersonToChangeStatus(person)
    setNewStatus(person.estado === "Activo" ? "Inactivo" : "Activo")
    setStatusPassword("")
    setStatusDialogOpen(true)
  }

  const handleStatusChange = async () => {
    if (statusPassword !== "Manu2026") {
      toast({
        title: "Error",
        description: "Contraseña incorrecta",
        variant: "destructive",
      })
      return
    }

    if (!personToChangeStatus) return

    try {
      console.log("[v0] Sending PATCH request to change status...")
      const response = await fetch(`/api/headcount/${personToChangeStatus.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
        },
        body: JSON.stringify({ estado: newStatus }),
        cache: "no-store",
      })

      console.log("[v0] Response status:", response.status)

      if (!response.ok) {
        const errorData = await response.json()
        console.error("[v0] Error response:", errorData)
        throw new Error("Failed to update status")
      }

      const updatedData = await response.json()
      console.log("[v0] Updated data received:", updatedData)

      setPeople((prevPeople) =>
        prevPeople.map((p) => (p.id === personToChangeStatus.id ? { ...p, estado: newStatus } : p)),
      )

      toast({
        title: "Éxito",
        description: `Estado cambiado a ${newStatus}`,
      })

      setStatusDialogOpen(false)
      setPersonToChangeStatus(null)
      setStatusPassword("")

      setTimeout(() => {
        loadPeople()
      }, 100)
    } catch (error) {
      console.error("[v0] Error changing status:", error)
      toast({
        title: "Error",
        description: "No se pudo cambiar el estado",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-2xl font-bold">Head Count</h1>
        <Button
          onClick={() => {
            resetForm()
            setDialogOpen(true)
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {activeTab === "administrativo" ? "Nuevo Administrativo" : "Nueva Persona"}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "operativo" | "administrativo")}>
        <TabsList>
          <TabsTrigger value="operativo" className="gap-1.5">
            <Users className="h-4 w-4" />
            Operativo
          </TabsTrigger>
          <TabsTrigger value="administrativo" className="gap-1.5">
            <Briefcase className="h-4 w-4" />
            Headcount Administrativo
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "administrativo" && (
        <p className="text-sm text-muted-foreground">
          Personal administrativo <strong>del proyecto seleccionado</strong>. Los registros creados
          aquí quedan marcados como administrativos y asignados a ese proyecto; para moverlos usa
          «Trasladar a otro proyecto».
          {sinProyecto > 0 && (
            <span className="text-amber-700">
              {" "}
              Hay {sinProyecto} sin proyecto asignado: aparecen en todos hasta que se trasladen.
            </span>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5 flex-1 min-w-[200px] max-w-sm">
          <Label htmlFor="search-id">Buscar por identificación</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="search-id"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              placeholder="Digite una identificación"
              className="pl-8 bg-white"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 w-[180px]">
          <Label htmlFor="status-filter">Estado</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger id="status-filter" className="bg-white">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="Activo">Activo</SelectItem>
              <SelectItem value="Inactivo">Inactivo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Cargando...</div>
      ) : (
        <div className="border rounded-lg overflow-x-auto bg-white">
          {/* `overflow-x-auto` y no `overflow-hidden`: las columnas de esta
              tabla suman ~1430px (la de Documentos sola pide 700px), y con
              `hidden` lo que no cabia en la pantalla no se podia alcanzar de
              ninguna forma. Ahora se desplaza dentro de su propia caja. */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Identificación</TableHead>
                <TableHead className="w-[200px]">Nombre</TableHead>
                <TableHead className="w-[160px]">Cargo</TableHead>
                <TableHead className="w-[100px]">Estado</TableHead>
                <TableHead className="min-w-[700px]">Documentos</TableHead>
                <TableHead className="text-right w-[150px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPeople.map((person) => (
                <TableRow key={person.id}>
                  <TableCell>{person.identificacion}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{person.nombre}</span>
                      {person.admin && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Briefcase className="h-3 w-3" />
                          Administrativo
                        </Badge>
                      )}
                      {/* Sin proyecto: aparece en TODOS los proyectos hasta que
                          alguien lo traslade. Se marca para que no se confunda
                          con alguien que si pertenece a este. */}
                      {person.idempresa == null && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-amber-400 text-[10px] text-amber-700"
                          title="No tiene proyecto asignado: se ve en todos. Usa 'Trasladar a otro proyecto' para asignarlo."
                        >
                          Sin proyecto
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{person.cargo || "-"}</TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        person.estado === "Activo" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {person.estado}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-[700px]">
                    <div className="grid grid-cols-5 gap-2">
                      {DOCUMENT_FIELDS.map((doc) => {
                        const hasDoc = person[doc.key as keyof HeadcountPerson]
                        return (
                          <div key={doc.key} className="relative group">
                            <label
                              className={`cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap ${
                                hasDoc
                                  ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                              }`}
                              title={doc.label}
                            >
                              {hasDoc ? (
                                <a
                                  href={person[doc.key as keyof HeadcountPerson] as string}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex items-center gap-1"
                                >
                                  <Eye className="h-3 w-3 flex-shrink-0" />
                                  <span className="text-[10px] truncate">{doc.label}</span>
                                </a>
                              ) : (
                                <>
                                  <Upload className="h-3 w-3 flex-shrink-0" />
                                  <span className="text-[10px] truncate">{doc.label}</span>
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0]
                                      if (file) handleFileUpload(file, person, doc.key)
                                    }}
                                    disabled={uploading}
                                  />
                                </>
                              )}
                            </label>
                          </div>
                        )
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openContactDialog(person)}
                        title="Ver correo y celular"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openTransferDialog(person)}
                        title="Trasladar a otro proyecto"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openStatusChangeDialog(person)}
                        title="Cambiar Estado"
                      >
                        <ShieldCheck className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(person)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(person.id!)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredPeople.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No se encontraron registros con los filtros aplicados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedPerson ? "Editar Persona" : "Nueva Persona"}</DialogTitle>
            <DialogDescription>Complete la información básica de la persona</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="identificacion">Identificación</Label>
              <Input
                id="identificacion"
                value={formData.identificacion}
                onChange={(e) => setFormData({ ...formData, identificacion: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contratosiigo">Contrato SIIGO</Label>
              <Input
                id="contratosiigo"
                value={formData.contratosiigo}
                onChange={(e) => setFormData({ ...formData, contratosiigo: e.target.value })}
                placeholder="Ingrese el número de contrato SIIGO"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="correo">Correo</Label>
              <Input
                id="correo"
                type="email"
                value={formData.correo}
                onChange={(e) => setFormData({ ...formData, correo: e.target.value })}
                placeholder="correo@ejemplo.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="celular">Celular</Label>
              <Input
                id="celular"
                type="tel"
                value={formData.celular}
                onChange={(e) => setFormData({ ...formData, celular: e.target.value })}
                placeholder="Ingrese el número de celular"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cargo">Cargo</Label>
              {activeTab === "administrativo" ? (
                /*
                  Para personal administrativo el cargo se escribe manualmente
                  como texto libre, ya que no se limita al listado fijo.
                */
                <Input
                  id="cargo"
                  value={formData.cargo}
                  onChange={(e) => setFormData({ ...formData, cargo: e.target.value })}
                  placeholder="Escribe el cargo"
                />
              ) : (
                /*
                  El cargo se elige del listado fijo de lib/headcount-cargos.ts
                  (AUXILIAR LOGÍSTICO, COORDINADOR, MONTACARGUISTA) y ningun
                  otro modulo lo puede cambiar. Para no perder valores
                  legacy guardados como texto libre, si `formData.cargo`
                  tiene un valor que NO esta en el listado lo agregamos como
                  SelectItem "fantasma" al inicio.
                */
                <Select
                  value={formData.cargo || undefined}
                  onValueChange={(v) => setFormData({ ...formData, cargo: v })}
                >
                  <SelectTrigger id="cargo">
                    <SelectValue placeholder="Selecciona un cargo" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.cargo && !(CARGOS_OPTIONS as readonly string[]).includes(formData.cargo) ? (
                      <SelectItem value={formData.cargo}>
                        {formData.cargo} (valor actual)
                      </SelectItem>
                    ) : null}
                    {CARGOS_OPTIONS.map((cargo) => (
                      <SelectItem key={cargo} value={cargo}>
                        {cargo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="fechainicio">Fecha de Inicio</Label>
              <DatePickerField
                id="fechainicio"
                value={formData.fechainicio}
                onChange={(value) => setFormData({ ...formData, fechainicio: value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="salario">Salario</Label>
              <Input
                id="salario"
                type="number"
                value={formData.salario}
                onChange={(e) => setFormData({ ...formData, salario: e.target.value })}
                placeholder="Ingrese el salario"
              />
            </div>

            {/* Fecha de retiro (baja). Se llena automáticamente al marcar la
                novedad "Retiro"; editable manualmente. Vacío = trabajador activo. */}
            <div className="space-y-2">
              <Label htmlFor="fecha_retiro">Fecha de Retiro</Label>
              <DatePickerField
                id="fecha_retiro"
                value={formData.fecha_retiro}
                onChange={(value) => setFormData({ ...formData, fecha_retiro: value })}
              />
            </div>

            {/* Datos de Seguridad Social (PILA): se capturan aquí, al
                contratar, porque es la única fuente que lee el exportador
                del archivo plano (lib/parafiscales-exportador-actions.ts) --
                ver scripts/170_add_pila_fields_headcount.sql. */}
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Seguridad Social (PILA)</p>

              <div className="space-y-2">
                <Label htmlFor="ciudad">Ciudad</Label>
                <Input
                  id="ciudad"
                  value={formData.ciudad}
                  onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })}
                  placeholder="Ej. BOGOTA"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="administradora_pension">AFP (Fondo de Pensión)</Label>
                <Select
                  value={formData.administradora_pension || undefined}
                  onValueChange={(v) => setFormData({ ...formData, administradora_pension: v })}
                >
                  <SelectTrigger id="administradora_pension">
                    <SelectValue placeholder="Selecciona la AFP" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.administradora_pension && !(Object.keys(CODIGOS_AFP)).includes(formData.administradora_pension) ? (
                      <SelectItem value={formData.administradora_pension}>
                        {formData.administradora_pension} (valor actual)
                      </SelectItem>
                    ) : null}
                    {Object.keys(CODIGOS_AFP).map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="administradora_salud">EPS</Label>
                <Select
                  value={formData.administradora_salud || undefined}
                  onValueChange={(v) => setFormData({ ...formData, administradora_salud: v })}
                >
                  <SelectTrigger id="administradora_salud">
                    <SelectValue placeholder="Selecciona la EPS" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.administradora_salud && !(Object.keys(CODIGOS_EPS)).includes(formData.administradora_salud) ? (
                      <SelectItem value={formData.administradora_salud}>
                        {formData.administradora_salud} (valor actual)
                      </SelectItem>
                    ) : null}
                    {Object.keys(CODIGOS_EPS).map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="administradora_caja">Caja de Compensación (código)</Label>
                <Input
                  id="administradora_caja"
                  value={formData.administradora_caja}
                  onChange={(e) => setFormData({ ...formData, administradora_caja: e.target.value })}
                  placeholder="Ej. CCF24"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="tipo_cotizante">Tipo de cotizante</Label>
                  <Input
                    id="tipo_cotizante"
                    value={formData.tipo_cotizante}
                    onChange={(e) => setFormData({ ...formData, tipo_cotizante: e.target.value })}
                    placeholder="Ej. 1. DEPENDIENTE"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subtipo_cotizante">Subtipo de cotizante</Label>
                  <Input
                    id="subtipo_cotizante"
                    value={formData.subtipo_cotizante}
                    onChange={(e) => setFormData({ ...formData, subtipo_cotizante: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label htmlFor="centro_trabajo">Centro de trabajo</Label>
                  <Input
                    id="centro_trabajo"
                    value={formData.centro_trabajo}
                    onChange={(e) => setFormData({ ...formData, centro_trabajo: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="actividad_economica">Actividad económica (CIIU)</Label>
                  <Input
                    id="actividad_economica"
                    value={formData.actividad_economica}
                    onChange={(e) => setFormData({ ...formData, actividad_economica: e.target.value })}
                    placeholder="Ej. 5222901"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* "Aplica plano" se retiró de la UI: el archivo plano se gobierna por
              el ESTADO (Inactivo = fuera del plano), no por esta bandera (que era
              huérfana). El campo sigue en el payload para no romper la API. */}

          {/* Marca de personal administrativo. En la pestaña administrativa se
              fuerza a true y se deshabilita para evitar desmarcarlo. */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="admin"
              checked={formData.admin}
              disabled={activeTab === "administrativo"}
              onCheckedChange={(checked) => setFormData({ ...formData, admin: checked === true })}
            />
            <Label htmlFor="admin" className="cursor-pointer font-normal">
              Personal administrativo
            </Label>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
                resetForm()
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trasladar a otro proyecto</DialogTitle>
            <DialogDescription>
              Está trasladando a {personToTransfer?.nombre} ({personToTransfer?.identificacion}) a otro proyecto
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="company">Seleccione la empresa destino</Label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger id="company">
                  <SelectValue placeholder="Seleccione una empresa..." />
                </SelectTrigger>
                <SelectContent>
                  {transferCompanies.map((company) => (
                    <SelectItem key={company.id} value={company.id.toString()}>
                      {company.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Qué se lleva el traslado y qué no.
                No todo el historial guarda su propio proyecto: la evidencia de
                inducciones, por ejemplo, lo deriva del head count, así que se
                MUEVE con la persona. Asistencia y nómina sí lo guardan y se
                quedan donde ocurrieron. Decirlo antes evita el susto de ver un
                indicador cambiar sin explicación. */}
            <div className="rounded-md border bg-muted/40 p-3 text-xs">
              <p className="font-medium">Qué pasa con su historial</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>
                  <strong>Se queda</strong> en el proyecto actual: asistencia, nómina, ausentismos,
                  bonos y liquidaciones. Guardan su propio proyecto.
                </li>
                <li>
                  <strong>Se mueve</strong> con la persona: evidencia de inducciones, contratos y
                  dotación. Dejarán de verse en el proyecto de origen.
                </li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTransferDialogOpen(false)
                setPersonToTransfer(null)
                setSelectedCompanyId("")
              }}
              disabled={transferLoading}
            >
              Cancelar
            </Button>
            <Button onClick={handleTransfer} disabled={transferLoading || !selectedCompanyId}>
              {transferLoading ? "Trasladando..." : "Trasladar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar Estado</DialogTitle>
            <DialogDescription>
              {personToChangeStatus && `Cambiar estado de ${personToChangeStatus.nombre} a ${newStatus}`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="status-password">Contraseña de administrador</Label>
              <Input
                id="status-password"
                type="password"
                placeholder="Ingrese la contraseña"
                value={statusPassword}
                onChange={(e) => setStatusPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleStatusChange()
                  }
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setStatusDialogOpen(false)
                setPersonToChangeStatus(null)
                setStatusPassword("")
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleStatusChange}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Info Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Informacion del Trabajador</DialogTitle>
            <DialogDescription>
              {contactPerson?.nombre} — {contactPerson?.identificacion}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Cargo</Label>
              <p className="text-sm font-medium">
                {contactPerson?.cargo || <span className="text-muted-foreground italic">Sin registrar</span>}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Fecha de Inicio</Label>
              <p className="text-sm font-medium">
                {contactPerson?.fechainicio
                  ? new Date(contactPerson.fechainicio + "T12:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" })
                  : <span className="text-muted-foreground italic">Sin registrar</span>}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Salario</Label>
              <p className="text-sm font-medium">
                {contactPerson?.salario
                  ? new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(contactPerson.salario)
                  : <span className="text-muted-foreground italic">Sin registrar</span>}
              </p>
            </div>
            <div className="border-t pt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Correo</Label>
                <p className="text-sm font-medium">
                  {contactPerson?.correo || <span className="text-muted-foreground italic">Sin registrar</span>}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Celular</Label>
                <p className="text-sm font-medium">
                  {contactPerson?.celular || <span className="text-muted-foreground italic">Sin registrar</span>}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setContactDialogOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
