"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Printer, Loader2, CheckCircle2, AlertCircle, Factory, Check, ChevronsUpDown } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { getProductsWithCodes, getAlmacenes, getLocationsWithId } from "@/lib/inventory-actions"
import { getMaxProduccionId, marcarProduccionHarinera } from "@/lib/qr-actions"
import { useAuth } from "@/components/auth-provider"

const API_URL = "https://duct-dose-gentleman.ngrok-free.dev/api/registro-manual"

/**
 * De quién es la producción que se está registrando.
 *
 *  - LIP      : servicio que presta LIP. Flujo normal: llega a invtrans, se
 *               aprueba, se liquida en Tolva y se factura.
 *  - Harinera : producción propia de Harinera. Genera inventario y pasa por
 *               aprobación, pero NUNCA llega a cabeceraoc ni a facturación, y
 *               no cuenta como producción de LIP en Control Piso.
 */
type TipoProduccion = "LIP" | "Harinera"

interface FormState {
  producto: string
  bodega: string
  localizacion: string
  lote: string
  bultos_procesados: string
  tipo_empaque: string
  tipo_produccion: TipoProduccion
}

const INITIAL_STATE: FormState = {
  producto: "",
  bodega: "",
  localizacion: "",
  lote: "",
  bultos_procesados: "",
  tipo_empaque: "Arrume",
  // LIP por defecto: es el comportamiento de siempre, y marcar Harinera por
  // descuido sacaría esa produccion de la facturacion sin que nadie lo note.
  tipo_produccion: "LIP",
}

interface ProductOption {
  id: number
  nombre: string
  codigo: string
}
interface AlmacenOption {
  id: number
  nombre: string
}
interface LocationOption {
  id: number
  codigo: string
  descripcion: string | null
}

export default function QRPalletRegistration() {
  const { selectedEmpresaId } = useAuth()
  const [formData, setFormData] = useState<FormState>(INITIAL_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<
    { type: "success"; id: string | number } | { type: "error"; message: string } | null
  >(null)

  /**
   * Aviso PERSISTENTE de que un registro de Harinera no se pudo marcar.
   *
   * No es un toast: si se pierde, esa producción queda como LIP y termina
   * facturada. Se queda en pantalla hasta que el operador la cierre.
   */
  const [avisoSinMarcar, setAvisoSinMarcar] = useState<string | null>(null)

  // Datos de las tablas
  const [products, setProducts] = useState<ProductOption[]>([])
  const [almacenes, setAlmacenes] = useState<AlmacenOption[]>([])
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [loadingLocations, setLoadingLocations] = useState(false)

  // Estado de apertura de cada combobox
  const [productoOpen, setProductoOpen] = useState(false)
  const [bodegaOpen, setBodegaOpen] = useState(false)
  const [localizacionOpen, setLocalizacionOpen] = useState(false)

  // Carga inicial de productos y almacenes
  useEffect(() => {
    if (!selectedEmpresaId) return
    ;(async () => {
      const [prods, alms] = await Promise.all([getProductsWithCodes(), getAlmacenes(selectedEmpresaId)])
      setProducts(prods as ProductOption[])
      setAlmacenes(alms as AlmacenOption[])
    })()
  }, [selectedEmpresaId])

  // Las localizaciones dependen del almacén seleccionado
  useEffect(() => {
    if (!formData.bodega) {
      setLocations([])
      return
    }
    ;(async () => {
      setLoadingLocations(true)
      const locs = await getLocationsWithId(Number.parseInt(formData.bodega, 10), selectedEmpresaId ?? undefined)
      setLocations(locs)
      setLoadingLocations(false)
    })()
  }, [formData.bodega, selectedEmpresaId])

  const handleChange = (field: keyof FormState, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const selectedProductName = products.find((p) => String(p.id) === formData.producto)?.nombre
  const selectedAlmacenName = almacenes.find((a) => String(a.id) === formData.bodega)?.nombre
  const selectedLocation = locations.find((l) => String(l.id) === formData.localizacion)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLastResult(null)

    const requiredFields: (keyof FormState)[] = [
      "producto",
      "bodega",
      "localizacion",
      "lote",
      "bultos_procesados",
    ]
    for (const field of requiredFields) {
      if (!formData[field].toString().trim()) {
        toast({
          title: "Campos incompletos",
          description: "Por favor complete todos los campos del formulario.",
          variant: "destructive",
        })
        return
      }
    }

    // Se envían los IDs seleccionados (no los nombres) al backend
    const payload = {
      producto: Number.parseInt(formData.producto, 10),
      bodega: Number.parseInt(formData.bodega, 10),
      localizacion: Number.parseInt(formData.localizacion, 10),
      lote: Number.parseInt(formData.lote, 10),
      bultos_procesados: Number.parseInt(formData.bultos_procesados, 10),
      tipo_empaque: formData.tipo_empaque,
    }

    const esHarinera = formData.tipo_produccion === "Harinera"

    setSubmitting(true)
    try {
      // Para Harinera hay que ubicar despues la fila que va a crear el servicio
      // externo. Se toma el max(id) ANTES del POST porque el id que devuelve el
      // servicio no es confiable (mas abajo se prueban cuatro nombres distintos
      // y se cae a "—").
      let maxIdPrevio = 0
      if (esHarinera) {
        const previo = await getMaxProduccionId()
        if (!previo.success) {
          setSubmitting(false)
          const msg =
            "No se pudo preparar el registro de Harinera (no se leyó el consecutivo de producción). " +
            "No se registró nada; intenta de nuevo."
          setLastResult({ type: "error", message: msg })
          toast({ title: "Registro no realizado", description: msg, variant: "destructive" })
          return
        }
        maxIdPrevio = previo.maxId
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        /*
         * El servicio de impresion explica POR QUE fallo, en el cuerpo de la
         * respuesta. Antes se descartaba y el operario solo veia "estado 500",
         * que no se puede accionar: hay que ir al servidor del servicio a leer
         * su consola para enterarse de algo que ya venia en la respuesta.
         *
         * El caso real (2026-10-06) fue "permission denied for table
         * produccion" -- el servicio quedo sin acceso a la base tras cerrar el
         * rol anonimo (SQL 220). Con el mensaje a la vista se reconoce al
         * instante; sin el, parecia un fallo de LIPgo.
         */
        let detalle = ""
        try {
          const cuerpo = await response.text()
          const msg = JSON.parse(cuerpo)?.message
          detalle = String(msg ?? cuerpo ?? "").slice(0, 300)
        } catch {
          // Si no se puede leer el cuerpo, queda el estado a secas.
        }
        const permisos = detalle.includes("permission denied")
        throw new Error(
          `El servicio de impresión respondió ${response.status}` +
            (detalle ? `: ${detalle}` : ".") +
            (permisos
              ? " — El servicio perdió el acceso a la base de datos; avisa a quien lo administra (ver scripts/241)."
              : ""),
        )
      }

      let generatedId: string | number = "—"
      try {
        const data = await response.json()
        generatedId = data?.id ?? data?.id_generado ?? data?.idqr ?? data?.registro_id ?? "—"
      } catch {
        // El backend pudo no devolver JSON; mantenemos el placeholder.
      }

      // La etiqueta ya se imprimió y la fila ya existe en producción (y, por el
      // trigger, en invtrans). Solo falta marcarla cuando es de Harinera.
      if (esHarinera) {
        const marcado = await marcarProduccionHarinera({
          maxIdPrevio,
          producto: payload.producto,
          bodega: payload.bodega,
          localizacion: payload.localizacion,
          lote: payload.lote,
          bultos: payload.bultos_procesados,
        })

        if (!marcado.success) {
          setAvisoSinMarcar(
            `El registro se creó y la etiqueta se imprimió, pero NO se pudo marcar como Harinera: ` +
              `${marcado.error ?? "motivo desconocido"}. ` +
              `Quedó como producción de LIP y SE FACTURARÁ si no se corrige. ` +
              `Datos para ubicarlo — producto: ${selectedProductName ?? payload.producto}, ` +
              `lote: ${payload.lote}, bultos: ${payload.bultos_procesados}` +
              (marcado.produccionId ? `, id de producción: ${marcado.produccionId}` : "") +
              `. Repórtalo para corregirlo.`,
          )
        }
      }

      setLastResult({ type: "success", id: generatedId })
      toast({
        title: "Etiqueta enviada a la impresora",
        description: `Registro exitoso. ID generado: ${generatedId}`,
      })
      setFormData(INITIAL_STATE)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo conectar con el servidor de impresión."
      setLastResult({ type: "error", message })
      toast({
        title: "Error en el registro",
        description: message,
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-full bg-background p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/30">
            <Factory className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">LipGo V3.0</h1>
            <p className="text-sm text-muted-foreground">Registro manual en línea de producción</p>
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="border-b">
            <CardTitle>Registro de Producción e Impresión de Etiqueta</CardTitle>
            <CardDescription>
              Complete los datos del proceso para generar la orden de impresión de la etiqueta térmica.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {/* Producto */}
                <div className="space-y-2">
                  <Label htmlFor="producto">Producto</Label>
                  <Popover open={productoOpen} onOpenChange={setProductoOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="producto"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={productoOpen}
                        className="w-full justify-between bg-transparent font-normal"
                      >
                        <span className="truncate">{selectedProductName || "Seleccionar producto"}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar producto..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>No se encontraron productos.</CommandEmpty>
                          <CommandGroup>
                            {products.map((product) => (
                              <CommandItem
                                key={product.id}
                                value={`${product.nombre} ${product.codigo}`}
                                onSelect={() => {
                                  handleChange("producto", String(product.id))
                                  setProductoOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    formData.producto === String(product.id) ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                {product.nombre}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Almacén / Bodega */}
                <div className="space-y-2">
                  <Label htmlFor="bodega">Almacén</Label>
                  <Popover open={bodegaOpen} onOpenChange={setBodegaOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="bodega"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={bodegaOpen}
                        className="w-full justify-between bg-transparent font-normal"
                      >
                        <span className="truncate">{selectedAlmacenName || "Seleccionar almacén"}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar almacén..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>No se encontraron almacenes.</CommandEmpty>
                          <CommandGroup>
                            {almacenes.map((almacen) => (
                              <CommandItem
                                key={almacen.id}
                                value={almacen.nombre}
                                onSelect={() => {
                                  handleChange("bodega", String(almacen.id))
                                  // Reiniciar localización al cambiar de almacén
                                  handleChange("localizacion", "")
                                  setBodegaOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    formData.bodega === String(almacen.id) ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                {almacen.nombre}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Localización */}
                <div className="space-y-2">
                  <Label htmlFor="localizacion">Localización</Label>
                  <Popover open={localizacionOpen} onOpenChange={setLocalizacionOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        id="localizacion"
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={localizacionOpen}
                        disabled={!formData.bodega || loadingLocations}
                        className="w-full justify-between bg-transparent font-normal"
                      >
                        <span className="truncate">
                          {selectedLocation
                            ? selectedLocation.codigo
                            : loadingLocations
                              ? "Cargando..."
                              : !formData.bodega
                                ? "Seleccione un almacén primero"
                                : "Seleccionar localización"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar localización..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>No se encontraron localizaciones.</CommandEmpty>
                          <CommandGroup>
                            {locations.map((loc) => (
                              <CommandItem
                                key={loc.id}
                                value={`${loc.codigo} ${loc.descripcion ?? ""}`}
                                onSelect={() => {
                                  handleChange("localizacion", String(loc.id))
                                  setLocalizacionOpen(false)
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    formData.localizacion === String(loc.id) ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                {loc.codigo}
                                {loc.descripcion ? (
                                  <span className="ml-2 text-muted-foreground">{loc.descripcion}</span>
                                ) : null}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Lote */}
                <div className="space-y-2">
                  <Label htmlFor="lote">Número de Lote</Label>
                  <Input
                    id="lote"
                    type="number"
                    inputMode="numeric"
                    value={formData.lote}
                    onChange={(e) => handleChange("lote", e.target.value)}
                    placeholder="Ej: 20260603"
                    required
                  />
                </div>

                {/* Bultos */}
                <div className="space-y-2">
                  <Label htmlFor="bultos_procesados">Cantidad de Bultos Procesados</Label>
                  <Input
                    id="bultos_procesados"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={formData.bultos_procesados}
                    onChange={(e) => handleChange("bultos_procesados", e.target.value)}
                    placeholder="Ej: 70"
                    required
                  />
                </div>

                {/* Modo de almacenamiento */}
                <div className="space-y-2">
                  <Label htmlFor="tipo_empaque">Modo de Almacenamiento</Label>
                  <Select
                    value={formData.tipo_empaque}
                    onValueChange={(value) => handleChange("tipo_empaque", value)}
                  >
                    <SelectTrigger id="tipo_empaque">
                      <SelectValue placeholder="Seleccione modo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Arrume">Arrume</SelectItem>
                      <SelectItem value="Estiba">Estiba</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Tipo de produccion: decide si esto se factura o no. */}
                <div className="space-y-2">
                  <Label htmlFor="tipo_produccion">Tipo de Producción</Label>
                  <Select
                    value={formData.tipo_produccion}
                    onValueChange={(value) => handleChange("tipo_produccion", value as TipoProduccion)}
                  >
                    <SelectTrigger id="tipo_produccion">
                      <SelectValue placeholder="Seleccione tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LIP">LIP</SelectItem>
                      <SelectItem value="Harinera">Harinera</SelectItem>
                    </SelectContent>
                  </Select>
                  {formData.tipo_produccion === "Harinera" && (
                    <p className="text-[11px] leading-tight text-amber-700">
                      Generará inventario y pasará por aprobación, pero no se liquidará en Tolva ni
                      se facturará.
                    </p>
                  )}
                </div>
              </div>

              {/* Aviso PERSISTENTE: si esto se pierde, esa producción se
                  factura. No se auto-cierra; el operador tiene que cerrarlo. */}
              {avisoSinMarcar && (
                <div className="flex items-start gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-destructive">
                      Quedó registrado como LIP — requiere corrección
                    </p>
                    <p className="mt-1 text-foreground">{avisoSinMarcar}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-8"
                      onClick={() => setAvisoSinMarcar(null)}
                    >
                      Entendido, ya lo reporté
                    </Button>
                  </div>
                </div>
              )}

              {lastResult?.type === "success" && (
                <div className="flex items-start gap-3 rounded-lg border border-[var(--chart-3)]/30 bg-[var(--chart-3)]/10 p-3 text-sm text-[var(--chart-3)]">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">Etiqueta enviada a la impresora</p>
                    <p className="text-muted-foreground">ID generado por el sistema: {lastResult.id}</p>
                  </div>
                </div>
              )}

              {lastResult?.type === "error" && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">No se pudo completar el registro</p>
                    <p className="text-muted-foreground">{lastResult.message}</p>
                  </div>
                </div>
              )}

              <Button type="submit" disabled={submitting} className="w-full gap-2">
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Registrando e Imprimiendo...
                  </>
                ) : (
                  <>
                    <Printer className="h-4 w-4" />
                    Registrar e Imprimir Etiqueta
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
