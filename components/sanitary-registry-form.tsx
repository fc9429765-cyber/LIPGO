"use client"

import React, { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Truck, ClipboardCheck, Wrench, Camera } from "lucide-react"
import { getVehiclesForSanitaryRegistry, registerSanitaryVerification, uploadSanitaryPhoto } from "@/lib/orders-actions"
import { getVehiclesForSanitaryWithoutOrder } from "@/lib/vehicle-actions"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { VehicleInspectionForm } from "@/components/vehicle-inspection-form"
import { Eyebrow } from "@/components/ui/lipgo"

interface SanitaryRegistryFormProps {
  initialVehicleId?: number | null
  onVehicleLoaded?: () => void
}

export function SanitaryRegistryForm({ initialVehicleId, onVehicleLoaded }: SanitaryRegistryFormProps) {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()
  const [registrationType, setRegistrationType] = useState<"with-order" | "vehicle-only">("with-order")
  const [vehicles, setVehicles] = useState<any[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(initialVehicleId || null)
  const [citasVehiculosId, setCitasVehiculosId] = useState<number | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    placa: "",
    conductor: "",
    ordenCargue: "",
    productoCargar: "",
    paredesPisos: "Si",
    limpieza: "Si",
    olores: "Si",
    proteccionPiso: "Si",
    fumigacion: "Si",
    plaguicidaUsado: "",
    nombreFumigador: "",
    observaciones: "",
    evidenciaFotografica: null as File | null,
    auxiliarLogistico: "",
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<{
    vehicleId?: boolean
    auxiliarLogistico?: boolean
  }>({})

  React.useEffect(() => {
    loadVehicles()
  }, [registrationType])

  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        window.innerWidth < 768 ||
          /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
      )
    }
    checkMobile()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  React.useEffect(() => {
    if (initialVehicleId && vehicles.length > 0) {
      const vehicle = vehicles.find((v) => v.id === initialVehicleId)
      if (vehicle) {
        handleVehicleSelect(initialVehicleId.toString())
        onVehicleLoaded?.()
      }
    }
  }, [initialVehicleId, vehicles])

  const loadVehicles = async () => {
    if (registrationType === "vehicle-only") {
      const result = await getVehiclesForSanitaryWithoutOrder(selectedEmpresaId ?? undefined)
      if (result.success && result.data) {
        setVehicles(result.data)
      } else {
        toast({
          title: "Error",
          description: "Error al cargar vehículos",
          variant: "destructive",
        })
      }
    } else {
      const result = await getVehiclesForSanitaryRegistry()
      if (result.success && result.data) {
        setVehicles(result.data)
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al cargar vehículos",
          variant: "destructive",
        })
      }
    }
  }

  const handleVehicleSelect = (vehicleId: string) => {
    const id = Number.parseInt(vehicleId)
    setSelectedVehicleId(id)

    const vehicle = vehicles.find((v) => v.id === id)
    if (vehicle) {
      if (registrationType === "vehicle-only") {
        setCitasVehiculosId(id)
        setFormData((prev) => ({
          ...prev,
          placa: vehicle.placa || "",
          conductor: vehicle.nombreconductor || "",
          ordenCargue: "",
        }))
      } else {
        setCitasVehiculosId(null)
        setFormData((prev) => ({
          ...prev,
          placa: vehicle.placa || "",
          ordenCargue: vehicle.ordendecargue || "",
          conductor: vehicle.conductor || "",
        }))
      }
    }
  }

  const handleRegistrationTypeChange = (value: string) => {
    setRegistrationType(value as "with-order" | "vehicle-only")
    setSelectedVehicleId(null)
    setCitasVehiculosId(null)
    setFormData({
      placa: "",
      conductor: "",
      ordenCargue: "",
      productoCargar: "",
      paredesPisos: "Si",
      limpieza: "Si",
      olores: "Si",
      proteccionPiso: "Si",
      fumigacion: "Si",
      plaguicidaUsado: "",
      nombreFumigador: "",
      observaciones: "",
      evidenciaFotografica: null,
      auxiliarLogistico: "",
    })
    setFieldErrors({})
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast({
          title: "Error",
          description: "Solo se permiten archivos de imagen",
          variant: "destructive",
        })
        return
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "Error",
          description: "El archivo no debe superar 5MB",
          variant: "destructive",
        })
        return
      }

      setFormData((prev) => ({ ...prev, evidenciaFotografica: file }))
    }
  }

  const handleBrowseClick = () => {
    fileInputRef.current?.click()
  }

  const handleReject = async () => {
    const allInspectionsPassed =
      formData.paredesPisos === "Si" &&
      formData.limpieza === "Si" &&
      formData.olores === "Si" &&
      formData.proteccionPiso === "Si" &&
      formData.fumigacion === "Si"

    if (allInspectionsPassed) {
      toast({
        title: "Error",
        description: "No es posible rechazar el registro cuando todas las validaciones sean Si",
        variant: "destructive",
      })
      return
    }

    const errors: { vehicleId?: boolean; auxiliarLogistico?: boolean } = {}

    if (!selectedVehicleId) {
      errors.vehicleId = true
      toast({
        title: "Error",
        description: "Debe seleccionar una placa de vehículo",
        variant: "destructive",
      })
    }

    if (!formData.auxiliarLogistico.trim()) {
      errors.auxiliarLogistico = true
      toast({
        title: "Error",
        description: "El campo Auxiliar Logístico es obligatorio para rechazar",
        variant: "destructive",
      })
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setIsSubmitting(true)

    try {
      let photoUrl: string | null = null
      if (formData.evidenciaFotografica) {
        setIsUploadingPhoto(true)
        const uploadResult = await uploadSanitaryPhoto(formData.evidenciaFotografica, formData.ordenCargue)
        setIsUploadingPhoto(false)

        if (uploadResult.success && uploadResult.url) {
          photoUrl = uploadResult.url
        }
      }

      const result = await registerSanitaryVerification({
        ordencargue: formData.ordenCargue,
        placa: formData.placa,
        conductor: formData.conductor,
        producto: formData.productoCargar,
        carpas: formData.paredesPisos,
        limpieza: formData.limpieza,
        olores: formData.olores,
        plastico: formData.proteccionPiso,
        fumigacion: formData.fumigacion,
        plaguicida: formData.plaguicidaUsado,
        observaciones: formData.observaciones,
        fumigador: formData.nombreFumigador,
        auxiliar: formData.auxiliarLogistico,
        foto: photoUrl,
        vehicleId: selectedVehicleId,
        aprobacion: "rechazado",
      })

      if (result.success) {
        toast({
          title: "Éxito",
          description: result.message,
        })
        setSelectedVehicleId(null)
        setFormData({
          placa: "",
          conductor: "",
          ordenCargue: "",
          productoCargar: "",
          paredesPisos: "Si",
          limpieza: "Si",
          olores: "Si",
          proteccionPiso: "Si",
          fumigacion: "Si",
          plaguicidaUsado: "",
          nombreFumigador: "",
          observaciones: "",
          evidenciaFotografica: null,
          auxiliarLogistico: "",
        })
        if (fileInputRef.current) {
          fileInputRef.current.value = ""
        }
        loadVehicles()
        setFieldErrors({})
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al rechazar inspección",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error rejecting inspection:", error)
      toast({
        title: "Error",
        description: "Error inesperado al rechazar inspección",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
      setIsUploadingPhoto(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const errors: { vehicleId?: boolean; auxiliarLogistico?: boolean } = {}

    if (!selectedVehicleId) {
      errors.vehicleId = true
      toast({
        title: "Error",
        description: "Debe seleccionar una placa de vehículo",
        variant: "destructive",
      })
    }

    if (!formData.auxiliarLogistico.trim()) {
      errors.auxiliarLogistico = true
      toast({
        title: "Error",
        description: "El campo Auxiliar Logístico es obligatorio",
        variant: "destructive",
      })
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setIsSubmitting(true)

    try {
      let photoUrl: string | null = null
      if (formData.evidenciaFotografica) {
        setIsUploadingPhoto(true)
        const uploadResult = await uploadSanitaryPhoto(
          formData.evidenciaFotografica,
          registrationType === "vehicle-only" ? formData.placa : formData.ordenCargue,
        )
        setIsUploadingPhoto(false)

        if (uploadResult.success && uploadResult.url) {
          photoUrl = uploadResult.url
        } else {
          toast({
            title: "Advertencia",
            description: "No se pudo subir la foto, pero se continuará con el registro",
            variant: "destructive",
          })
        }
      }

      const result = await registerSanitaryVerification({
        ordencargue: formData.ordenCargue,
        placa: formData.placa,
        conductor: formData.conductor,
        producto: formData.productoCargar,
        carpas: formData.paredesPisos,
        limpieza: formData.limpieza,
        olores: formData.olores,
        plastico: formData.proteccionPiso,
        fumigacion: formData.fumigacion,
        plaguicida: formData.plaguicidaUsado,
        observaciones: formData.observaciones,
        fumigador: formData.nombreFumigador,
        auxiliar: formData.auxiliarLogistico,
        foto: photoUrl,
        vehicleId: registrationType === "with-order" ? selectedVehicleId : undefined,
        aprobacion: "aprobado",
        isVehicleOnly: registrationType === "vehicle-only",
        citasVehiculosId: registrationType === "vehicle-only" ? citasVehiculosId : undefined,
      })

      if (result.success) {
        toast({
          title: "Éxito",
          description: result.message,
        })
        setSelectedVehicleId(null)
        setCitasVehiculosId(null)
        setFormData({
          placa: "",
          conductor: "",
          ordenCargue: "",
          productoCargar: "",
          paredesPisos: "Si",
          limpieza: "Si",
          olores: "Si",
          proteccionPiso: "Si",
          fumigacion: "Si",
          plaguicidaUsado: "",
          nombreFumigador: "",
          observaciones: "",
          evidenciaFotografica: null,
          auxiliarLogistico: "",
        })
        if (fileInputRef.current) {
          fileInputRef.current.value = ""
        }
        loadVehicles()
        setFieldErrors({})
      } else {
        toast({
          title: "Error",
          description: result.message || "Error al registrar verificación sanitaria",
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error submitting form:", error)
      toast({
        title: "Error",
        description: "Error inesperado al registrar verificación",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
      setIsUploadingPhoto(false)
    }
  }

  // Empresa 1 usa un formulario distinto: "Inspeccion Sanitaria de
  // Vehiculos". Cualquier otra empresa mantiene el formulario original.
  // El return condicional va despues de declarar todos los hooks para no
  // violar las reglas de los hooks de React.
  if (selectedEmpresaId === 1) {
    return <VehicleInspectionForm />
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Eyebrow>Recepción y Despacho · Portería y vehículos</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Registro Sanitario</h1>
          <p className="text-sm text-muted-foreground">Inspección sanitaria de vehículos de carga</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-primary">Tipo de Registro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <RadioGroup value={registrationType} onValueChange={handleRegistrationTypeChange}>
                <div className="flex flex-row gap-6">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="with-order" id="with-order" />
                    <Label htmlFor="with-order" className="cursor-pointer font-normal">
                      Con orden de cargue
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="vehicle-only" id="vehicle-only" />
                    <Label htmlFor="vehicle-only" className="cursor-pointer font-normal">
                      Solo placa
                    </Label>
                  </div>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-primary">
              <Truck className="h-5 w-5" />
              Datos del Vehículo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="placa">
                  Placa del Vehículo <span className="text-destructive">*</span>
                </Label>
                <Select value={selectedVehicleId?.toString() || ""} onValueChange={handleVehicleSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione una placa" />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                        {vehicle.placa}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {registrationType === "with-order" && (
                <div className="space-y-2">
                  <Label htmlFor="ordenCargue">Orden de Cargue</Label>
                  <Input id="ordenCargue" value={formData.ordenCargue} className="bg-muted" readOnly />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="conductor">Conductor</Label>
                <Input id="conductor" value={formData.conductor} className="bg-muted" readOnly />
              </div>

              <div className="space-y-2">
                <Label htmlFor="productoCargar">Producto a Cargar</Label>
                <Input
                  id="productoCargar"
                  value={formData.productoCargar}
                  onChange={(e) => setFormData((prev) => ({ ...prev, productoCargar: e.target.value }))}
                  placeholder="Ingrese el producto a cargar"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-primary">
              <ClipboardCheck className="h-5 w-5" />
              Inspección Sanitaria
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <Label className="flex-1">¿Paredes y pisos en buen estado?</Label>
                <Select
                  value={formData.paredesPisos}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, paredesPisos: value }))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Si">Sí</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label className="flex-1">¿Cumple con limpieza (sin extraños)?</Label>
                <Select
                  value={formData.limpieza}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, limpieza: value }))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Si">Sí</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label className="flex-1">¿Libre de olores extraños?</Label>
                <Select
                  value={formData.olores}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, olores: value }))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Si">Sí</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label className="flex-1">¿Cuenta con protección para el piso?</Label>
                <Select
                  value={formData.proteccionPiso}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, proteccionPiso: value }))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Si">Sí</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <Label className="flex-1">¿Se realizó la fumigación del vehículo?</Label>
                <Select
                  value={formData.fumigacion}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, fumigacion: value }))}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Si">Sí</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              {formData.fumigacion === "Si" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="plaguicidaUsado">Plaguicida Usado</Label>
                    <Input
                      id="plaguicidaUsado"
                      value={formData.plaguicidaUsado}
                      onChange={(e) => setFormData((prev) => ({ ...prev, plaguicidaUsado: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nombreFumigador">Nombre de Fumigador</Label>
                    <Input
                      id="nombreFumigador"
                      value={formData.nombreFumigador}
                      onChange={(e) => setFormData((prev) => ({ ...prev, nombreFumigador: e.target.value }))}
                    />
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-primary">
              <Wrench className="h-5 w-5" />
              Datos Adicionales
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="observaciones">Observaciones</Label>
              <Textarea
                id="observaciones"
                value={formData.observaciones}
                onChange={(e) => setFormData((prev) => ({ ...prev, observaciones: e.target.value }))}
                rows={5}
                placeholder="Ingrese observaciones adicionales..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="evidenciaFotografica" className="text-sm md:text-base">
                  Evidencia Fotográfica
                </Label>
                <input
                  id="evidenciaFotografica"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture={isMobile ? "environment" : undefined}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleBrowseClick}
                    disabled={isUploadingPhoto}
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    {isUploadingPhoto ? "Subiendo..." : isMobile ? "Tomar Foto" : "Examinar..."}
                  </Button>
                  <span className="text-sm text-muted-foreground truncate">
                    {formData.evidenciaFotografica
                      ? formData.evidenciaFotografica.name
                      : "No se ha seleccionado ningún archivo."}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="auxiliarLogistico">
                  Auxiliar Logístico <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="auxiliarLogistico"
                  value={formData.auxiliarLogistico}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      auxiliarLogistico: e.target.value,
                    }))
                  }
                  required
                  className={fieldErrors.auxiliarLogistico ? "border-destructive border-2" : ""}
                />
                {fieldErrors.auxiliarLogistico && <p className="text-sm text-destructive">Este campo es obligatorio</p>}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row justify-end gap-3">
          <Button
            type="button"
            size="lg"
            variant="destructive"
            className="w-full sm:w-auto"
            disabled={isSubmitting || isUploadingPhoto}
            onClick={handleReject}
          >
            <ClipboardCheck className="h-4 w-4 mr-2" />
            {isUploadingPhoto ? "Subiendo foto..." : isSubmitting ? "Rechazando..." : "Rechazar Inspección"}
          </Button>
          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={isSubmitting || isUploadingPhoto}>
            <ClipboardCheck className="h-4 w-4 mr-2" />
            {isUploadingPhoto ? "Subiendo foto..." : isSubmitting ? "Registrando..." : "Registrar Verificación"}
          </Button>
        </div>
      </form>
    </div>
  )
}
