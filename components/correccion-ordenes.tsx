"use client"

// CORRECCIÓN DE ÓRDENES (Gestión Financiera) — buscar una orden por número y
// corregir cabeceraoc/detalleoc desde la app (antes solo se podía a mano en
// Supabase). Cada corrección exige un motivo en texto libre; el detalle
// campo-por-campo ya queda auditado automáticamente (trigger fn_auditoria en
// cabeceraoc/detalleoc). Ver lib/correccion-ordenes-actions.ts.

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Loader2, Search, Plus, X, Check, ChevronsUpDown, FileEdit } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { createClient } from "@/lib/supabase-client"
import {
  buscarOrdenParaCorreccion,
  guardarCorreccionOrden,
  type OrdenCorreccionCabecera,
  type CabeceraEditable,
} from "@/lib/correccion-ordenes-actions"
import { useClaveAccion } from "@/components/clave-accion-provider"

interface LineaEditable {
  _key: string
  id: number | null
  producto: string
  cantidad: number
  toneladas: number
}

let contadorKey = 0
const nuevaKey = () => `linea-${Date.now()}-${contadorKey++}`

const TIPOS_PAGO = [
  { value: "global", label: "Global" },
  { value: "individual", label: "Individual" },
]

export default function CorreccionOrdenes() {
  const { toast } = useToast()
  const { conClave } = useClaveAccion()

  const [numeroOrdenInput, setNumeroOrdenInput] = useState("")
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const [contexto, setContexto] = useState<OrdenCorreccionCabecera | null>(null)
  const [cabecera, setCabecera] = useState<CabeceraEditable | null>(null)
  const [lineas, setLineas] = useState<LineaEditable[]>([])
  const [lineasEliminadasIds, setLineasEliminadasIds] = useState<number[]>([])
  const [motivo, setMotivo] = useState("")

  const [transportes, setTransportes] = useState<{ id: number; nombretransporte: string }[]>([])
  const [productos, setProductos] = useState<{ id: number; nombre: string }[]>([])
  const [catalogosCargados, setCatalogosCargados] = useState(false)
  const [openCombobox, setOpenCombobox] = useState<Record<string, boolean>>({})

  const cargarCatalogos = async () => {
    if (catalogosCargados) return
    try {
      const supabase = await createClient()
      const [{ data: t }, { data: p }] = await Promise.all([
        supabase.from("transportes").select("id, nombretransporte"),
        supabase.from("productos").select("id, nombre"),
      ])
      setTransportes((t as any[]) ?? [])
      setProductos((p as any[]) ?? [])
      setCatalogosCargados(true)
    } catch {
      // Si falla, los selects de transporte/producto quedan como texto libre.
    }
  }

  const limpiarTodo = () => {
    setContexto(null)
    setCabecera(null)
    setLineas([])
    setLineasEliminadasIds([])
    setMotivo("")
  }

  const buscar = async (numero: string) => {
    if (!numero.trim()) return
    setBuscando(true)
    cargarCatalogos()
    try {
      const r = await buscarOrdenParaCorreccion(numero.trim())
      if (!r.success || !r.data) {
        toast({ title: "No encontrada", description: r.message || "No se encontró la orden.", variant: "destructive" })
        limpiarTodo()
        return
      }
      const { cabecera: c, lineas: l } = r.data
      setContexto(c)
      setCabecera({
        pesovascula: c.pesovascula,
        pesoorden: c.pesoorden,
        placa: c.placa,
        conductor: c.conductor,
        celular: c.celular,
        transporte: c.transporte,
        cliente: c.cliente,
        fechacargue: c.fechacargue,
        auxiliares: c.auxiliares,
        muelle: c.muelle,
        tipo_pago: c.tipo_pago,
      })
      setLineas(l.map((linea) => ({ ...linea, _key: nuevaKey() })))
      setLineasEliminadasIds([])
      setMotivo("")
    } finally {
      setBuscando(false)
    }
  }

  const actualizarCabecera = <K extends keyof CabeceraEditable>(campo: K, valor: CabeceraEditable[K]) => {
    setCabecera((prev) => (prev ? { ...prev, [campo]: valor } : prev))
  }

  const agregarLinea = () => {
    setLineas((prev) => [...prev, { _key: nuevaKey(), id: null, producto: "", cantidad: 0, toneladas: 0 }])
  }

  const eliminarLinea = (key: string) => {
    setLineas((prev) => {
      const linea = prev.find((l) => l._key === key)
      if (linea?.id != null) setLineasEliminadasIds((ids) => [...ids, linea.id as number])
      return prev.filter((l) => l._key !== key)
    })
  }

  const actualizarLinea = (key: string, campo: "producto" | "cantidad" | "toneladas", valor: string | number) => {
    setLineas((prev) => prev.map((l) => (l._key === key ? { ...l, [campo]: valor } : l)))
  }

  const totalToneladas = lineas.reduce((acc, l) => acc + (Number(l.toneladas) || 0), 0)

  const validarEnCliente = (): string | null => {
    if (!motivo.trim()) return "Explica el motivo de la corrección antes de guardar."
    if (!cabecera?.placa?.trim()) return "La placa no puede quedar vacía."
    if (cabecera.pesovascula != null && cabecera.pesovascula < 0) return "El peso de báscula no puede ser negativo."
    if (cabecera.pesoorden != null && cabecera.pesoorden < 0) return "El peso de orden no puede ser negativo."
    if (cabecera.muelle != null && (!Number.isInteger(cabecera.muelle) || cabecera.muelle <= 0)) {
      return "El muelle debe ser un número entero positivo."
    }
    if (lineas.length === 0) return "La orden debe tener al menos una línea de producto."
    for (const l of lineas) {
      if (!l.producto.trim()) return "Todas las líneas deben tener un producto."
      if (!(l.cantidad > 0)) return "La cantidad de cada línea debe ser mayor a 0."
      if (l.toneladas < 0) return "Las toneladas no pueden ser negativas."
    }
    return null
  }

  const guardar = async () => {
    if (!contexto || !cabecera) return
    const errorValidacion = validarEnCliente()
    if (errorValidacion) {
      toast({ title: "Falta corregir", description: errorValidacion, variant: "destructive" })
      return
    }
    setGuardando(true)
    try {
      const r = await conClave("Corrección de Órdenes", "editar", (clave) => guardarCorreccionOrden({
        ordenId: contexto.id,
        ordendecargue: contexto.ordendecargue,
        motivo,
        cabecera,
        lineas: lineas.map((l) => ({ id: l.id, producto: l.producto, cantidad: l.cantidad, toneladas: l.toneladas })),
        lineasEliminadasIds,
      }, clave))
      if (!r.success) {
        toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
        return
      }
      toast({ title: "Corrección guardada", description: r.message })
      await buscar(contexto.ordendecargue)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileEdit className="h-5 w-5 text-primary" />
          Corrección de Órdenes
        </CardTitle>
        <CardDescription>
          Busca una orden por número y corrige su información. Todo cambio queda auditado, y cada corrección exige un
          motivo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Número de orden</Label>
            <Input
              placeholder="Ej. MOL202609159166"
              value={numeroOrdenInput}
              onChange={(e) => setNumeroOrdenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && buscar(numeroOrdenInput)}
              className="h-8 text-xs"
            />
          </div>
          <Button size="sm" disabled={!numeroOrdenInput.trim() || buscando} onClick={() => buscar(numeroOrdenInput)}>
            {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-2">Buscar</span>
          </Button>
        </div>

        {contexto && cabecera && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
              <Badge variant="outline">Orden: {contexto.ordendecargue}</Badge>
              <Badge variant="outline">{contexto.tipooperacion || "-"}</Badge>
              <Badge variant="outline">Fecha orden: {contexto.fechaorden || "-"}</Badge>
              <Separator orientation="vertical" className="h-5" />
              <span className="text-xs text-muted-foreground">
                Factura Siigo: <span className="font-medium text-foreground">{contexto.facturasiigo || "sin gestionar"}</span>
                {" · "}
                Estado: <span className="font-medium text-foreground">{contexto.estadofactura || "-"}</span>
                {" — estos campos se gestionan desde Facturación, no desde aquí."}
              </span>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">Datos de la orden</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Peso báscula</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={cabecera.pesovascula ?? ""}
                    onChange={(e) => actualizarCabecera("pesovascula", e.target.value === "" ? null : Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Peso orden</Label>
                  <Input
                    type="number"
                    step="0.001"
                    value={cabecera.pesoorden ?? ""}
                    onChange={(e) => actualizarCabecera("pesoorden", e.target.value === "" ? null : Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Placa</Label>
                  <Input
                    value={cabecera.placa ?? ""}
                    onChange={(e) => actualizarCabecera("placa", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Conductor</Label>
                  <Input
                    value={cabecera.conductor ?? ""}
                    onChange={(e) => actualizarCabecera("conductor", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Celular</Label>
                  <Input
                    type="tel"
                    value={cabecera.celular ?? ""}
                    onChange={(e) => actualizarCabecera("celular", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Transporte</Label>
                  <Select value={cabecera.transporte ?? undefined} onValueChange={(v) => actualizarCabecera("transporte", v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cabecera.transporte && !transportes.some((t) => t.nombretransporte === cabecera.transporte) && (
                        <SelectItem value={cabecera.transporte}>{cabecera.transporte}</SelectItem>
                      )}
                      {transportes.map((t) => (
                        <SelectItem key={t.id} value={t.nombretransporte}>
                          {t.nombretransporte}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cliente</Label>
                  <Input
                    value={cabecera.cliente ?? ""}
                    onChange={(e) => actualizarCabecera("cliente", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fecha cargue</Label>
                  <DatePickerField
                    value={cabecera.fechacargue ?? ""}
                    onChange={(value) => actualizarCabecera("fechacargue", value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Muelle</Label>
                  <Input
                    type="number"
                    step="1"
                    value={cabecera.muelle ?? ""}
                    onChange={(e) => actualizarCabecera("muelle", e.target.value === "" ? null : Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de pago</Label>
                  <Select value={cabecera.tipo_pago ?? undefined} onValueChange={(v) => actualizarCabecera("tipo_pago", v)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_PAGO.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2 md:col-span-3">
                  <Label className="text-xs">Auxiliares</Label>
                  <Textarea
                    value={cabecera.auxiliares ?? ""}
                    onChange={(e) => actualizarCabecera("auxiliares", e.target.value)}
                    className="text-xs min-h-16"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Productos</h3>
                <Button size="sm" variant="outline" onClick={agregarLinea}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar línea
                </Button>
              </div>
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-28">Cantidad</TableHead>
                      <TableHead className="w-28">Toneladas</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineas.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-16 text-center text-xs text-muted-foreground">
                          Sin líneas. Agrega al menos una.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lineas.map((linea) => (
                        <TableRow key={linea._key}>
                          <TableCell>
                            <Popover
                              open={openCombobox[linea._key] || false}
                              onOpenChange={(open) => setOpenCombobox((prev) => ({ ...prev, [linea._key]: open }))}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn("w-full justify-between h-8 text-xs", !linea.producto && "text-muted-foreground")}
                                >
                                  {linea.producto || "Seleccionar producto..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-full p-0">
                                <Command>
                                  <CommandInput placeholder="Buscar producto..." />
                                  <CommandList>
                                    <CommandEmpty>No se encontró producto.</CommandEmpty>
                                    <CommandGroup>
                                      {productos.map((p) => (
                                        <CommandItem
                                          key={p.id}
                                          value={p.nombre}
                                          onSelect={() => {
                                            actualizarLinea(linea._key, "producto", p.nombre)
                                            setOpenCombobox((prev) => ({ ...prev, [linea._key]: false }))
                                          }}
                                        >
                                          <Check className={cn("mr-2 h-4 w-4", linea.producto === p.nombre ? "opacity-100" : "opacity-0")} />
                                          {p.nombre}
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              value={linea.cantidad}
                              onChange={(e) => actualizarLinea(linea._key, "cantidad", Number(e.target.value))}
                              className="h-8 text-xs"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.001"
                              value={linea.toneladas}
                              onChange={(e) => actualizarLinea(linea._key, "toneladas", Number(e.target.value))}
                              className="h-8 text-xs"
                            />
                          </TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => eliminarLinea(linea._key)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 mt-2 text-xs">
                <span>
                  Líneas: <span className="font-semibold text-foreground">{lineas.length}</span>
                </span>
                <span>
                  Toneladas totales:{" "}
                  <span className="font-semibold text-foreground tabular-nums">{totalToneladas.toFixed(3)}</span>
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Motivo de la corrección</Label>
              <Textarea
                placeholder="Explica qué se corrigió y por qué (obligatorio)."
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="text-xs min-h-20"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={limpiarTodo} disabled={guardando}>
                Cancelar
              </Button>
              <Button onClick={guardar} disabled={guardando}>
                {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar corrección
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
