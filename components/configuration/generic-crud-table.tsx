"use client"

import { AlertDialogDescription } from "@/components/ui/alert-dialog"
import { Card, CardContent } from "@/components/ui/card"

import { useState, useEffect, useMemo } from "react"
import type { ModuleDefinition } from "@/lib/config-definitions"
import {
  createConfigRecord,
  updateConfigRecord,
  deleteConfigRecord,
  getNextId,
  fetchVehicleTypeCapacity,
} from "@/lib/config-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Pencil, Plus, Search, Loader2, Trash2, Download, RefreshCw } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useAuth } from "@/components/auth-provider"
import { emitTablaChanged, tablaChangedEvent } from "@/lib/sync-events"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useClaveAccion } from "@/components/clave-accion-provider"
import { moduloDeTabla } from "@/lib/config-tablas"

interface GenericCrudTableProps {
  moduleDef: ModuleDefinition
  hideNewButton?: boolean
}

export function GenericCrudTable({ moduleDef, hideNewButton = false }: GenericCrudTableProps) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const { conClave } = useClaveAccion()
  const [searchTerm, setSearchTerm] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<any | null>(null)
  const [formData, setFormData] = useState<any>({})
  const [saving, setSaving] = useState(false)
  const [selectOptions, setSelectOptions] = useState<Record<string, any[]>>({})
  const [allSubcategorias, setAllSubcategorias] = useState<any[]>([])
  const [allDestinos, setAllDestinos] = useState<any[]>([])
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [recordToDelete, setRecordToDelete] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deletePassword, setDeletePassword] = useState("")
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [ciudadSearch, setCiudadSearch] = useState("")
  const [showCiudadDropdown, setShowCiudadDropdown] = useState(false)

  const [selectSearchTerms, setSelectSearchTerms] = useState<Record<string, string>>({})
  const [showSelectDropdowns, setShowSelectDropdowns] = useState<Record<string, boolean>>({})

  const [transporteFilter, setTransporteFilter] = useState<string>("todos")
  const [tipoVehiculoFilter, setTipoVehiculoFilter] = useState<string>("todos")
  const [tipoDespachoFilter, setTipoDespachoFilter] = useState<string>("todos")
  const [placaFilter, setPlacaFilter] = useState<string>("")

  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 1000

  const { profile, selectedEmpresaId } = useAuth()

  useEffect(() => {
    if (selectedEmpresaId) {
      loadData()
      loadSelectOptions()
    }
  }, [moduleDef.tableName, selectedEmpresaId])

  // Sincronización: si otro componente muta esta misma tabla (p. ej. la tarjeta de
  // vehículos no procesados al cerrar/eliminar), se recarga esta tabla al instante.
  useEffect(() => {
    const ev = tablaChangedEvent(moduleDef.tableName)
    const handler = () => { loadData() }
    window.addEventListener(ev, handler)
    return () => window.removeEventListener(ev, handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleDef.tableName, selectedEmpresaId])

  const loadData = async () => {
    setLoading(true)
    try {
      const url = selectedEmpresaId 
        ? `/api/config-data?table=${moduleDef.tableName}&empresaId=${selectedEmpresaId}`
        : `/api/config-data?table=${moduleDef.tableName}`
      const response = await fetch(url)
      const result = await response.json()

      if (result.success) {
        setData(result.data || [])
      } else {
        toast({
          title: "Error",
          description: "No se pudieron cargar los datos.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("[v0] Error loading data:", error)
      toast({
        title: "Error",
        description: "No se pudieron cargar los datos.",
        variant: "destructive",
      })
    }
    setLoading(false)
  }

  const loadSelectOptions = async () => {
    const options: Record<string, any[]> = {}

    for (const field of moduleDef.fields) {
      if (field.type === "select" && field.name === "categoriaid") {
        const response = await fetch("/api/categorias")
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((cat: any) => ({
            label: cat.nombre,
            value: cat.id,
          }))
        }
      }
      if (field.type === "select" && field.name === "categoria") {
        const response = await fetch("/api/categorias")
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((cat: any) => ({
            label: cat.nombre,
            value: cat.nombre,
          }))
        }
      }
      if (field.type === "select" && field.name === "subcategoria") {
        const response = await fetch("/api/subcategorias")
        const result = await response.json()
        if (result.success && result.data) {
          setAllSubcategorias(result.data)
          options[field.name] = result.data.map((subcat: any) => ({
            label: subcat.nombre,
            value: subcat.nombre,
            categoriaid: subcat.categoriaid,
          }))
        }
      }
      if (field.type === "select" && field.name === "clienteid") {
        const response = await fetch(`/api/clientes${selectedEmpresaId ? `?empresaId=${selectedEmpresaId}` : ""}`)
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((cliente: any) => ({
            label: cliente.nombre,
            value: cliente.id,
          }))
        }
      }
      if (field.type === "select" && field.name === "idempresa") {
        if (moduleDef.tableName === "tarifas") {
          const response = await fetch("/api/owners")
          // La respuesta puede venir vacia o con error; parseamos con cuidado
          // para evitar "Unexpected end of JSON input".
          const text = await response.text()
          let data: any = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = null
          }
          if (response.ok && Array.isArray(data)) {
            options[field.name] = data.map((owner: any) => ({
              label: owner.nombre,
              value: owner.id,
            }))
          } else {
            options[field.name] = []
            console.error("[v0] /api/owners no devolvio una lista valida:", data)
          }
        } else {
          const response = await fetch("/api/empresas")
          const result = await response.json()
          if (result.success && result.data) {
            options[field.name] = result.data.map((empresa: any) => ({
              label: empresa.nombre,
              value: empresa.id,
            }))
          }
        }
      }
      if (field.type === "select" && (field.name === "ciudad" || field.name === "departamento")) {
        const response = await fetch("/api/destinos")
        const result = await response.json()
        if (result.success && result.data) {
          setAllDestinos(result.data)

          if (field.name === "departamento") {
            const uniqueDepartamentos = Array.from(
              new Set(result.data.map((destino: any) => destino.departamento).filter(Boolean)),
            ).sort()
            options[field.name] = uniqueDepartamentos.map((dep: any) => ({
              label: dep,
              value: dep,
            }))
          } else if (field.name === "ciudad") {
            options[field.name] = result.data.map((destino: any) => ({
              label: destino.nombre,
              value: destino.nombre,
              departamento: destino.departamento,
            }))
          }
        }
      }
      if (field.type === "select" && field.name === "transporte") {
        const response = await fetch("/api/transportes")
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((transporte: any) => ({
            label: transporte.nombretransporte,
            value: transporte.nombretransporte,
          }))
        }
      }
      if (field.type === "select" && field.name === "tipovehiculo") {
        const response = await fetch("/api/tipos-vehiculos")
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((tipo: any) => ({
            label: tipo.nombretipo,
            value: tipo.nombretipo,
          }))
        }
      }
      if (field.type === "select" && field.name === "tipoproducto") {
        const response = await fetch("/api/categorias")
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((cat: any) => ({
            label: cat.nombre,
            value: cat.nombre,
          }))
        }
      }
      if (field.type === "select" && field.name === "tipodespacho") {
        const response = await fetch("/api/tipos-despacho")
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((tipo: any) => ({
            label: tipo.nombretipodespacho,
            value: tipo.nombretipodespacho,
          }))
        }
      }
      if (field.type === "select" && field.name === "bodegaid") {
        const empresaId = selectedEmpresaId || 1
        const almacenesResult = await fetch(`/api/almacenes?empresaId=${empresaId}`).then((r) => r.json())
        if (almacenesResult) {
          options[field.name] = almacenesResult.data.map((almacen: any) => ({
            label: almacen.nombre,
            value: almacen.id,
          }))
        }
      }
      if (field.type === "select" && field.name === "bodega") {
        const empresaId = selectedEmpresaId || 1
        const response = await fetch(`/api/almacenes?empresaId=${empresaId}`)
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((almacen: any) => ({
            label: almacen.nombre,
            value: almacen.id,
          }))
        }
      }
      if (field.type === "select" && field.name === "proveedor") {
        const response = await fetch(`/api/config-data?table=proveedores`)
        const result = await response.json()
        if (result.success && result.data) {
          options[field.name] = result.data.map((proveedor: any) => ({
            label: proveedor.nombre,
            value: proveedor.nombre,
          }))
        }
      }
    }

    setSelectOptions(options)
  }

  const filterSubcategoriasByCategoria = async (categoriaNombre: string) => {
    if (!categoriaNombre) {
      setSelectOptions((prev) => ({
        ...prev,
        subcategoria: allSubcategorias.map((subcat: any) => ({
          label: subcat.nombre,
          value: subcat.nombre, // Use name as value
          categoriaid: subcat.categoriaid,
        })),
      }))
      return
    }

    // Get the categoria ID from the name
    const result = await fetch("/api/categorias") // Changed from fetchCategorias()
    const categoriasData = await result.json()

    if (categoriasData.success && categoriasData.data) {
      const categoria = categoriasData.data.find((cat: any) => cat.nombre === categoriaNombre)
      if (categoria) {
        const filtered = allSubcategorias.filter((subcat: any) => subcat.categoriaid === categoria.id)
        setSelectOptions((prev) => ({
          ...prev,
          subcategoria: filtered.map((subcat: any) => ({
            label: subcat.nombre,
            value: subcat.nombre, // Use name as value
            categoriaid: subcat.categoriaid,
          })),
        }))
      }
    }
  }

  const filterCiudadesByDepartamento = (departamento: string) => {
    if (!departamento || !allDestinos.length) {
      // If no departamento selected, show all cities
      setSelectOptions((prev) => ({
        ...prev,
        ciudad: allDestinos.map((destino: any) => ({
          label: destino.nombre,
          value: destino.nombre,
          departamento: destino.departamento,
        })),
      }))
    } else {
      // Filter cities by selected departamento
      const filteredCities = allDestinos
        .filter((destino: any) => destino.departamento === departamento)
        .map((destino: any) => ({
          label: destino.nombre,
          value: destino.nombre,
          departamento: destino.departamento,
        }))

      setSelectOptions((prev) => ({
        ...prev,
        ciudad: filteredCities,
      }))
    }
  }

  const handleAddNew = async () => {
    setEditingRecord(null)
    const initialData: any = {}

    const nextIdResult = await getNextId(moduleDef.tableName, moduleDef.primaryKey)
    if (nextIdResult.success) {
      initialData[moduleDef.primaryKey] = nextIdResult.nextId
    }

    moduleDef.fields.forEach((field) => {
      if (field.name !== moduleDef.primaryKey && field.defaultValue !== undefined) {
        initialData[field.name] = field.defaultValue
      } else if (field.name !== moduleDef.primaryKey && field.type === "boolean") {
        initialData[field.name] = field.defaultValue ?? true
      }
    })
    setFormData(initialData)
    setIsDialogOpen(true)
    setCiudadSearch("")
    setShowCiudadDropdown(false)
    setSelectSearchTerms({})
    setShowSelectDropdowns({})
  }

  const handleEdit = (record: any) => {
    setEditingRecord(record)
    setFormData({ ...record })
    setIsDialogOpen(true)
    setCiudadSearch("")
    setShowCiudadDropdown(false)
    setSelectSearchTerms({})
    setShowSelectDropdowns({})
  }

  const handleDeleteClick = (record: any) => {
    setRecordToDelete(record)
    setDeletePassword("")
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return

    // Para citasvehiculos (Ver Vehiculo) reemplazamos la antigua
    // validacion por contraseña por una regla de negocio: solo se
    // puede eliminar un vehiculo que NO tenga Orden de Cargue
    // asignada. El campo `ocargue` se setea cuando la cita ya tiene
    // una OC vinculada; si trae valor, bloqueamos el borrado para
    // evitar romper la trazabilidad de la operacion.
    if (moduleDef.tableName === "citasvehiculos") {
      const ocargue = (recordToDelete as any).ocargue
      const tieneOC =
        ocargue !== null &&
        ocargue !== undefined &&
        String(ocargue).trim() !== ""
      if (tieneOC) {
        toast({
          title: "No se puede eliminar",
          description: `Este vehículo tiene la Orden de Cargue ${ocargue} asignada. Elimine primero la OC para poder borrarlo.`,
          variant: "destructive",
        })
        return
      }
    }

    setDeleting(true)
    try {
      const result = await conClave(moduloDeTabla(moduleDef.tableName) ?? "", "configurar", (clave) => deleteConfigRecord(
        moduleDef.tableName,
        moduleDef.primaryKey,
        recordToDelete[moduleDef.primaryKey], { clave }))

      if (result.success) {
        toast({
          title: "Éxito",
          description: "Registro eliminado correctamente.",
        })
        await loadData()
        emitTablaChanged(moduleDef.tableName)
        setDeleteDialogOpen(false)
        setRecordToDelete(null)
        setDeletePassword("")
      } else {
        toast({
          title: "Error",
          description: "No se pudo eliminar el registro.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error(error)
      toast({
        title: "Error",
        description: "Ocurrió un error inesperado.",
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  const validateClienteField = (fieldName: string, value: string): string | null => {
    if (!value) return null

    switch (fieldName) {
      case "nombre":
        // Alphanumeric validation (letters, numbers, spaces allowed)
        const nombreRegex = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]+$/
        if (!nombreRegex.test(value)) {
          return "El nombre puede contener letras, números y espacios"
        }
        break
      case "personacontacto":
        // Only alphabetic validation
        const contactoRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/
        if (!contactoRegex.test(value)) {
          return "La persona de contacto solo puede contener letras y espacios"
        }
        break
      case "celular":
        // Exactly 10 numeric digits
        const celularRegex = /^[0-9]{10}$/
        if (!celularRegex.test(value)) {
          return "El celular debe tener exactamente 10 dígitos numéricos"
        }
        break
      case "correo":
      case "correofact":
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(value)) {
          return "Utilizar un formato de correo válido"
        }
        break
    }
    return null
  }

  const validateVendedorField = (fieldName: string, value: string): string | null => {
    if (!value) return null

    switch (fieldName) {
      case "cedula":
        const cedulaRegex = /^[0-9]+$/
        if (!cedulaRegex.test(value)) {
          return "La cédula solo puede contener números"
        }
        break
      case "celular":
        const celularRegex = /^[0-9]{10}$/
        if (!celularRegex.test(value)) {
          return "El celular debe tener exactamente 10 dígitos numéricos"
        }
        break
      case "correo":
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(value)) {
          return "Utilizar un formato de correo válido"
        }
        break
    }
    return null
  }

  const validateVehiculoField = (fieldName: string, value: string): string | null => {
    if (!value) return null

    switch (fieldName) {
      case "nombreconductor":
        const nombreRegex = /^[A-ZÁÉÍÓÚÑ\s]+$/
        if (!nombreRegex.test(value)) {
          return "El nombre del conductor solo puede contener letras mayúsculas"
        }
        break
      case "telefono":
        const telefonoRegex = /^[0-9]{10}$/
        if (!telefonoRegex.test(value)) {
          return "El teléfono debe tener exactamente 10 dígitos numéricos"
        }
        break
      case "placa":
        const placaRegex = /^[A-Z0-9]+$/
        if (!placaRegex.test(value)) {
          return "La placa solo puede contener letras mayúsculas y números"
        }
        break
    }
    return null
  }

  const handleSave = async () => {
    const requiredFields = moduleDef.fields.filter(
      (field) => field.required && !field.hidden && field.showInForm !== false,
    )
    const emptyFields = requiredFields.filter((field) => {
      const value = formData[field.name]
      return value === undefined || value === null || value === ""
    })

    if (emptyFields.length > 0) {
      toast({
        title: "Error",
        description: `Por favor complete los siguientes campos: ${emptyFields.map((f) => f.label).join(", ")}`,
        variant: "destructive",
      })
      return
    }

    if (moduleDef.id === "clientes") {
      const errors: Record<string, string> = {}

      if (formData.nombre) {
        const error = validateClienteField("nombre", formData.nombre)
        if (error) errors.nombre = error
      }

      if (formData.personacontacto) {
        const error = validateClienteField("personacontacto", formData.personacontacto)
        if (error) errors.personacontacto = error
      }

      if (formData.celular) {
        const error = validateClienteField("celular", formData.celular)
        if (error) errors.celular = error
      }

      if (formData.correo) {
        const error = validateClienteField("correo", formData.correo)
        if (error) errors.correo = error
      }

      if (formData.correofact) {
        const error = validateClienteField("correofact", formData.correofact)
        if (error) errors.correofact = error
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors)
        toast({
          title: "Error de validación",
          description: "Por favor corrija los errores en el formulario antes de guardar.",
          variant: "destructive",
        })
        return
      }
    }

    if (moduleDef.id === "vendedores") {
      const errors: Record<string, string> = {}

      if (formData.cedula) {
        const error = validateVendedorField("cedula", formData.cedula)
        if (error) errors.cedula = error
      }

      if (formData.celular) {
        const error = validateVendedorField("celular", formData.celular)
        if (error) errors.celular = error
      }

      if (formData.correo) {
        const error = validateVendedorField("correo", formData.correo)
        if (error) errors.correo = error
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors)
        toast({
          title: "Error de validación",
          description: "Por favor corrija los errores en el formulario antes de guardar.",
          variant: "destructive",
        })
        return
      }
    }

    if (moduleDef.id === "citas_vehiculos") {
      const errors: Record<string, string> = {}

      if (formData.nombreconductor) {
        const error = validateVehiculoField("nombreconductor", formData.nombreconductor)
        if (error) errors.nombreconductor = error
      }

      if (formData.telefono) {
        const error = validateVehiculoField("telefono", formData.telefono)
        if (error) errors.telefono = error
      }

      if (formData.placa) {
        const error = validateVehiculoField("placa", formData.placa)
        if (error) errors.placa = error
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors)
        toast({
          title: "Error de validación",
          description: "Por favor corrija los errores en el formulario antes de guardar.",
          variant: "destructive",
        })
        return
      }
    }

    setSaving(true)
    try {
      let result
      if (editingRecord) {
        const { [moduleDef.primaryKey]: _, ...updateData } = formData
        // Remove cliente field if it exists
        if ("cliente" in updateData) {
          delete updateData.cliente
        }
        // Auto-assign idempresa from session for bodegas module
if (moduleDef.tableName === "almacenes" && selectedEmpresaId) {
      updateData.idempresa = selectedEmpresaId
        }
        result = await conClave(moduloDeTabla(moduleDef.tableName) ?? "", "configurar", (clave) => updateConfigRecord(
          moduleDef.tableName,
          moduleDef.primaryKey,
          editingRecord[moduleDef.primaryKey],
          updateData, { clave }))
      } else {
        const { cliente, ...insertData } = formData
        result = await conClave(moduloDeTabla(moduleDef.tableName) ?? "", "configurar", (clave) => createConfigRecord(moduleDef.tableName, insertData, selectedEmpresaId ?? undefined, { clave }))
        
        // Auto-generate codigo for productos after creation
        if (result.success && moduleDef.tableName === "productos" && result.data?.id) {
          const codigo = `PT000${result.data.id}`
          const updateResult = await updateConfigRecord(moduleDef.tableName, moduleDef.primaryKey, result.data.id, { codigo })
          if (!updateResult.success) {
            console.error("Failed to generate codigo:", updateResult.error)
          }
        }
      }

      if (result.success) {
        toast({
          title: "Éxito",
          description: editingRecord ? "Registro actualizado correctamente." : "Registro creado correctamente.",
        })
        setIsDialogOpen(false)
        setValidationErrors({})
        setFormData({})
        await loadData()
        emitTablaChanged(moduleDef.tableName)
      } else {
        toast({
          title: "Error",
          description: (result as any).message || "No se pudo guardar el registro.",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error(error)
      toast({
        title: "Error",
        description: "Ocurrió un error inesperado.",
        variant: "destructive",
      })
    }
    setSaving(false)
  }

  const exportToExcel = () => {
    const filas = filteredData
    if (filas.length === 0) {
      toast({
        title: "Sin datos",
        description: "No hay datos para exportar.",
        variant: "destructive",
      })
      return
    }

    const visibleFieldsForExport = moduleDef.fields.filter((f) => !f.hidden)
    // CSV real con comillas (soporta comas, ; y saltos), BOM `﻿` para que Excel
    // muestre bien los acentos (ó/í/ñ), y `?? ""` para NO convertir 0/false en vacío.
    // Exporta lo FILTRADO (lo que el usuario ve tras búsqueda/filtros), no todo.
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v)
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = visibleFieldsForExport.map((f) => esc(f.label)).join(",")
    const rows = filas
      .map((row) => visibleFieldsForExport.map((field) => esc(row[field.name] ?? "")).join(","))
      .join("\n")

    const csv = `﻿${headers}\n${rows}`
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${moduleDef.name}_${new Date().toISOString().split("T")[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const filteredData = data.filter((item) => {
    const matchesSearch = Object.values(item).some((val) =>
      String(val).toLowerCase().includes(searchTerm.toLowerCase()),
    )

    if (moduleDef.id === "citas_vehiculos") {
      const matchesTransporte =
        !transporteFilter || transporteFilter === "todos" || item.transporte === transporteFilter
      const matchesTipoVehiculo =
        !tipoVehiculoFilter || tipoVehiculoFilter === "todos" || item.tipovehiculo === tipoVehiculoFilter
      const matchesTipoDespacho =
        !tipoDespachoFilter || tipoDespachoFilter === "todos" || item.tipodespacho === tipoDespachoFilter
      const matchesPlaca = !placaFilter || (item.placa && item.placa.toLowerCase().includes(placaFilter.toLowerCase()))

      return matchesSearch && matchesTransporte && matchesTipoVehiculo && matchesTipoDespacho && matchesPlaca
    }

    return matchesSearch
  })

  // Calculate pagination
  const totalPages = Math.ceil(filteredData.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedData = filteredData.slice(startIndex, startIndex + itemsPerPage)

  // Reset to page 1 when search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const visibleFields = moduleDef.fields.filter((f) => {
    if (f.hidden) return false
    if (moduleDef.id === "sucursales" && f.name === "clienteid") return false
    if (moduleDef.id === "subcategorias" && f.name === "categoriaid") return false
    return true
  })

  const filteredCiudadOptions = useMemo(() => {
    if (!ciudadSearch) {
      return selectOptions.ciudad || []
    }
    return (selectOptions.ciudad || []).filter((option: any) =>
      option.label.toLowerCase().includes(ciudadSearch.toLowerCase()),
    )
  }, [ciudadSearch, selectOptions.ciudad])

  const shouldDisableActions = (row: any) => {
    if (moduleDef.id === "citas_vehiculos") {
      return !!(row.horapesoinicial || row.horaregistro)
    }
    return false
  }

  const handleVehicleTypeChange = async (vehicleTypeName: string) => {
    const result = await fetchVehicleTypeCapacity(vehicleTypeName)
    if (result.success && result.capacidad !== null) {
      setFormData((prev: any) => ({
        ...prev,
        capacidad: result.capacidad,
      }))
    }
  }

  if (!moduleDef) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Error: Módulo no encontrado. Por favor, verifique la configuración.
      </div>
    )
  }

  return (
    <div className="p-2 sm:p-4 space-y-2 sm:space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <h2 className="text-base sm:text-lg font-semibold">{moduleDef.name}</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button
            onClick={loadData}
            size="sm"
            variant="outline"
            disabled={loading}
            className="h-7 sm:h-8 text-xs flex-1 sm:flex-initial bg-transparent"
          >
            <RefreshCw className={`h-3 w-3 sm:h-4 sm:w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          {!hideNewButton && (
            <Button onClick={handleAddNew} size="sm" className="h-7 sm:h-8 text-xs flex-1 sm:flex-initial">
              <Plus className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              Nuevo
            </Button>
          )}
          {moduleDef.id === "citas_vehiculos" && (
            <Button
              onClick={exportToExcel}
              size="sm"
              variant="outline"
              className="h-7 sm:h-8 text-xs flex-1 sm:flex-initial bg-transparent"
            >
              <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
              Exportar Excel
            </Button>
          )}
        </div>
      </div>

      {moduleDef.id === "citas_vehiculos" && (
        <Card className="bg-white">
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-sm">Placa</Label>
                <div className="relative">
                  <Input
                    placeholder="Buscar por placa..."
                    value={placaFilter}
                    onChange={(e) => setPlacaFilter(e.target.value.toUpperCase())}
                    className="h-10 text-sm w-10/12"
                  />
                  {placaFilter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1 h-8 w-8 p-0"
                      onClick={() => setPlacaFilter("")}
                    >
                      ×
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Transporte</Label>
                <Select value={transporteFilter} onValueChange={setTransporteFilter}>
                  <SelectTrigger className="h-10 text-sm w-10/12">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {Array.from(new Set(data.map((d) => d.transporte).filter(Boolean))).map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Tipo Vehículo</Label>
                <Select value={tipoVehiculoFilter} onValueChange={setTipoVehiculoFilter}>
                  <SelectTrigger className="h-10 text-sm w-10/12">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {Array.from(new Set(data.map((d) => d.tipovehiculo).filter(Boolean))).map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">Tipo Despacho</Label>
                <Select value={tipoDespachoFilter} onValueChange={setTipoDespachoFilter}>
                  <SelectTrigger className="h-10 text-sm w-10/12">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {Array.from(new Set(data.map((d) => d.tipodespacho).filter(Boolean))).map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {moduleDef.id !== "citas_vehiculos" && (
        <div className="flex items-center space-x-2">
          <Search className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
          <Input
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-full sm:max-w-sm h-7 sm:h-8 text-xs sm:text-sm bg-white"
          />
        </div>
      )}

      <div className="w-full overflow-x-auto overflow-y-auto max-h-[calc(100vh-280px)] sm:max-h-[calc(100vh-250px)] rounded-md border bg-white">
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              {visibleFields.map((field) => (
                <TableHead key={field.name} className="text-[10px] sm:text-xs whitespace-nowrap font-semibold">
                  {field.label}
                </TableHead>
              ))}
              <TableHead className="w-[80px] sm:w-[100px] text-[10px] sm:text-xs font-semibold sticky right-0 bg-background">
                Acciones
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={visibleFields.length + 1} className="h-20 sm:h-24 text-center text-xs">
                  <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            ) : filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={visibleFields.length + 1} className="h-20 sm:h-24 text-center text-xs">
                  No se encontraron registros.
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row: any, rowIndex) => (
                <TableRow key={row[moduleDef.primaryKey] || `row-${rowIndex}`}>
                  {moduleDef.fields
                    .filter((field) => !field.hidden)
                    .map((field) => (
                      <TableCell key={field.name} className="text-[10px] sm:text-xs whitespace-nowrap">
                        {field.type === "boolean" ? (
                          <Checkbox checked={!!row[field.name]} disabled className="h-3 w-3" />
                        ) : (
                          row[field.name]
                        )}
                      </TableCell>
                    ))}
                  <TableCell className="sticky right-0 bg-background">
                    <div className="flex gap-0.5 sm:gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 sm:h-6 sm:w-6"
                        onClick={() => handleEdit(row)}
                        disabled={shouldDisableActions(row)}
                      >
                        <Pencil className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                      </Button>
                      {moduleDef.canDelete !== false &&
                        (() => {
                          // Para Ver Vehiculo (citasvehiculos): si la
                          // fila ya tiene Orden de Cargue asignada
                          // (campo `ocargue` con valor), deshabilitamos
                          // el boton Eliminar y mostramos un tooltip
                          // explicando por que. Para el resto de
                          // modulos el boton se comporta como antes.
                          const isCitasVehiculos =
                            moduleDef.tableName === "citasvehiculos"
                          const ocargue = (row as any).ocargue
                          const tieneOC =
                            isCitasVehiculos &&
                            ocargue !== null &&
                            ocargue !== undefined &&
                            String(ocargue).trim() !== ""
                          return (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 sm:h-6 sm:w-6 text-red-500 hover:text-red-700 disabled:text-muted-foreground disabled:cursor-not-allowed"
                              onClick={() => handleDeleteClick(row)}
                              disabled={tieneOC}
                              title={
                                tieneOC
                                  ? `No se puede eliminar: vehiculo asignado a la OC ${ocargue}`
                                  : "Eliminar"
                              }
                            >
                              <Trash2 className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                            </Button>
                          )
                        })()}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      {filteredData.length > itemsPerPage && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 px-2">
          <div className="text-sm text-muted-foreground">
            Mostrando {startIndex + 1} a {Math.min(startIndex + itemsPerPage, filteredData.length)} de {filteredData.length} registros
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-center">
            <Button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              variant="outline"
              size="sm"
              className="bg-transparent"
            >
              Primera
            </Button>
            <Button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              variant="outline"
              size="sm"
              className="bg-transparent"
            >
              Anterior
            </Button>
            
            {/* Show page numbers with smart pagination */}
            <div className="flex items-center gap-1">
              {totalPages <= 5 ? (
                // Show all pages if 5 or less
                Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <Button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    variant={currentPage === page ? "default" : "outline"}
                    size="sm"
                    className={currentPage === page ? "" : "bg-transparent"}
                  >
                    {page}
                  </Button>
                ))
              ) : (
                // Show first, dots, current range, dots, last
                <>
                  {currentPage > 3 && (
                    <>
                      <Button
                        onClick={() => setCurrentPage(1)}
                        variant="outline"
                        size="sm"
                        className="bg-transparent"
                      >
                        1
                      </Button>
                      <span className="text-muted-foreground">...</span>
                    </>
                  )}
                  {Array.from(
                    { length: Math.min(3, totalPages) },
                    (_, i) => Math.max(1, currentPage - 1 + i),
                  ).map((page) => (
                    <Button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      className={currentPage === page ? "" : "bg-transparent"}
                    >
                      {page}
                    </Button>
                  ))}
                  {currentPage < totalPages - 2 && (
                    <>
                      <span className="text-muted-foreground">...</span>
                      <Button
                        onClick={() => setCurrentPage(totalPages)}
                        variant="outline"
                        size="sm"
                        className="bg-transparent"
                      >
                        {totalPages}
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>

            <Button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              variant="outline"
              size="sm"
              className="bg-transparent"
            >
              Siguiente
            </Button>
            <Button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              variant="outline"
              size="sm"
              className="bg-transparent"
            >
              Última
            </Button>
          </div>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              {editingRecord ? "Editar Registro" : "Nuevo Registro"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:gap-4 py-3 sm:py-4">
            {moduleDef.fields.map((field) => {
              if (field.hidden) return null
              if (field.showInForm === false) return null
              if (moduleDef.id === "sucursales" && field.name === "cliente") return null
              if (moduleDef.id === "subcategorias" && field.name === "categoria") return null
              if (moduleDef.id === "bodegas" && field.name === "idempresa") return null
              if (editingRecord && field.editable === false) return null

              return (
                <div key={field.name} className="grid grid-cols-4 items-start gap-4">
                  <Label htmlFor={field.name} className="text-left text-xs pt-2">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  <div className="col-span-3 space-y-1">
                    {field.type === "boolean" ? (
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id={field.name}
                          checked={!!formData[field.name]}
                          onCheckedChange={(checked) => setFormData({ ...formData, [field.name]: checked })}
                        />
                        <label
                          htmlFor={field.name}
                          className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {field.label}
                        </label>
                      </div>
                    ) : field.name === "responsabilidadfiscal" && moduleDef.id === "clientes" ? (
                      <div className="space-y-2">
                        {[
                          "Gran contribuyente",
                          "Autorretenedor",
                          "Agente de retención IVA",
                          "Régimen simple de tributación",
                          "No aplica - otros",
                        ].map((option) => {
                          const selectedOptions = formData.responsabilidadfiscal
                            ? formData.responsabilidadfiscal.split(", ")
                            : []
                          const isChecked = selectedOptions.includes(option)

                          return (
                            <div key={option} className="flex items-center space-x-2">
                              <Checkbox
                                id={`${field.name}-${option}`}
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  let newSelectedOptions = [...selectedOptions]
                                  if (checked) {
                                    newSelectedOptions.push(option)
                                  } else {
                                    newSelectedOptions = newSelectedOptions.filter((o) => o !== option)
                                  }
                                  setFormData({
                                    ...formData,
                                    [field.name]: newSelectedOptions.join(", "),
                                  })
                                }}
                              />
                              <label
                                htmlFor={`${field.name}-${option}`}
                                className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                              >
                                {option}
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    ) : field.type === "select" ? (
                      field.name === "ciudad" ? (
                        <div className="relative">
                          <Input
                            id={field.name}
                            type="text"
                            value={ciudadSearch}
                            onChange={(e) => {
                              setCiudadSearch(e.target.value)
                              setShowCiudadDropdown(true)
                            }}
                            onFocus={() => setShowCiudadDropdown(true)}
                            placeholder="Escribir o buscar ciudad..."
                            className="h-8 text-xs"
                          />
                          {showCiudadDropdown && filteredCiudadOptions.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 sm:max-h-60 overflow-auto">
                              {filteredCiudadOptions.map((option: any) => (
                                <button
                                  key={option.value}
                                  type="button"
                                  className="w-full text-left px-2 sm:px-3 py-2 sm:py-2 text-xs hover:bg-gray-100 cursor-pointer"
                                  onClick={() => {
                                    setFormData({ ...formData, [field.name]: option.value })
                                    setCiudadSearch(option.label)
                                    setShowCiudadDropdown(false)
                                  }}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="relative">
                          <Input
                            id={field.name}
                            type="text"
                            value={selectSearchTerms[field.name] || ""}
                            onChange={(e) => {
                              setSelectSearchTerms({ ...selectSearchTerms, [field.name]: e.target.value })
                              setShowSelectDropdowns({ ...showSelectDropdowns, [field.name]: true })
                            }}
                            onFocus={() => setShowSelectDropdowns({ ...showSelectDropdowns, [field.name]: true })}
                            placeholder={`Buscar ${field.label}...`}
                            className="h-8 text-xs"
                          />
                          {showSelectDropdowns[field.name] &&
                            (() => {
                              const options = selectOptions[field.name] || field.options || []
                              const searchTerm = selectSearchTerms[field.name]?.toLowerCase() || ""
                              const filteredOptions = options.filter((option: any) =>
                                option.label?.toLowerCase().includes(searchTerm),
                              )

                              return filteredOptions.length > 0 ? (
                                <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-48 sm:max-h-60 overflow-auto">
                                  {filteredOptions.map((option: any) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className="w-full text-left px-2 sm:px-3 py-2 sm:py-2 text-xs hover:bg-gray-100 cursor-pointer"
                                      onClick={async () => {
                                        const parsedValue =
                                          field.name === "categoriaid" ||
                                          field.name === "bodega" ||
                                          field.name === "idempresa"
                                            ? Number(option.value)
                                            : option.value
                                        setFormData({ ...formData, [field.name]: parsedValue })
                                        setSelectSearchTerms({ ...selectSearchTerms, [field.name]: option.label })
                                        setShowSelectDropdowns({ ...showSelectDropdowns, [field.name]: false })

                                        if (field.name === "categoria" && moduleDef.id === "productos") {
                                          filterSubcategoriasByCategoria(option.value)
                                          setFormData((prev: any) => ({
                                            ...prev,
                                            [field.name]: option.value,
                                            subcategoria: "",
                                          }))
                                        }

                                        if (field.name === "departamento" && moduleDef.id === "sucursales") {
                                          filterCiudadesByDepartamento(option.value)
                                          setFormData((prev: any) => ({
                                            ...prev,
                                            [field.name]: parsedValue,
                                            ciudad: "",
                                          }))
                                          setCiudadSearch("")
                                        }

                                        if (field.name === "tipovehiculo" && moduleDef.id === "citas_vehiculos") {
                                          handleVehicleTypeChange(option.value)
                                        }
                                      }}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              ) : null
                            })()}
                        </div>
                      )
                    ) : field.type === "date" ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "h-8 text-xs w-full justify-start text-left font-normal",
                              !formData[field.name] && "text-muted-foreground",
                            )}
                          >
                            <CalendarIcon className="mr-2 h-3 w-3" />
                            {formData[field.name] ? (
                              format(new Date(formData[field.name] + "T00:00:00"), "PPP", { locale: es })
                            ) : (
                              <span>Seleccionar fecha</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={formData[field.name] ? new Date(formData[field.name] + "T00:00:00") : undefined}
                            onSelect={(date) => {
                              setFormData({
                                ...formData,
                                [field.name]: date ? format(date, "yyyy-MM-dd") : "",
                              })
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <>
                        <Input
                          id={field.name}
                          type={field.type === "number" ? "number" : "text"}
                          value={formData[field.name] || ""}
                          onChange={(e) => {
                            let newValue = e.target.value

                            if (moduleDef.id === "citas_vehiculos") {
                              if (field.name === "nombreconductor") {
                                // Convert to uppercase for nombre conductor
                                newValue = newValue.toUpperCase()
                              } else if (field.name === "telefono") {
                                // Only allow numbers for telefono
                                newValue = newValue.replace(/[^0-9]/g, "").slice(0, 10)
                              } else if (field.name === "placa") {
                                // Convert to uppercase and remove non-alphanumeric for placa
                                newValue = newValue.toUpperCase().replace(/[^A-Z0-9]/g, "")
                              }
                            }

                            setFormData({ ...formData, [field.name]: newValue })

                            if (
                              moduleDef.id === "clientes" &&
                              ["nombre", "personacontacto", "celular", "correo", "correofact"].includes(field.name)
                            ) {
                              const error = validateClienteField(field.name, newValue)
                              setValidationErrors((prev) => {
                                const newErrors = { ...prev }
                                if (error) {
                                  newErrors[field.name] = error
                                } else {
                                  delete newErrors[field.name]
                                }
                                return newErrors
                              })
                            }

                            if (moduleDef.id === "vendedores" && ["cedula", "celular", "correo"].includes(field.name)) {
                              const error = validateVendedorField(field.name, newValue)
                              setValidationErrors((prev) => {
                                const newErrors = { ...prev }
                                if (error) {
                                  newErrors[field.name] = error
                                } else {
                                  delete newErrors[field.name]
                                }
                                return newErrors
                              })
                            }

                            if (
                              moduleDef.id === "citas_vehiculos" &&
                              ["nombreconductor", "telefono", "placa"].includes(field.name)
                            ) {
                              const error = validateVehiculoField(field.name, newValue)
                              setValidationErrors((prev) => {
                                const newErrors = { ...prev }
                                if (error) {
                                  newErrors[field.name] = error
                                } else {
                                  delete newErrors[field.name]
                                }
                                return newErrors
                              })
                            }
                          }}
                          required={
                            moduleDef.id === "citas_vehiculos" && field.name === "telefono" ? false : field.required
                          }
                          className={`h-8 text-xs ${validationErrors[field.name] ? "border-red-500" : ""}`}
                          disabled={field.name === moduleDef.primaryKey && !editingRecord}
                        />
                        {validationErrors[field.name] && (
                          <div className="flex items-center gap-1 text-red-500 text-xs mt-1">
                            <span className="font-medium">⚠</span>
                            <span>{validationErrors[field.name]}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsDialogOpen(false)
                setValidationErrors({})
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Está seguro?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El registro será eliminado permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600"
            >
              {deleting && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
