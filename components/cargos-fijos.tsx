"use client"

// CARGOS FIJOS (Gestión Financiera) — conceptos que se facturan/pagan por un
// monto fijo mensual, sin relación con órdenes de cargue ni turnos:
//   · Alquiler de montacargas (por equipo, ID1/ID2/ID3 pagan; solo ID1/ID3
//     lo facturan aparte — ID2 lo trae embebido en su facturación general).
//   · Cargos del proyecto: $2.000.000/mes en ID1/ID3 ("Manejo de Inventario
//     y Aplicación LIPgo"), 600 toneladas fijas/mes en ID2 (dos tramos).
//
// Cada mes se GENERA (idempotente) un registro por concepto y se rastrea
// facturado/pendiente con el mismo criterio que Solicitar Facturas:
// `facturasiigo` manda.

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Loader2, RefreshCw, Settings, Upload, X, Truck, Landmark } from "lucide-react"
import { getAllEmpresas } from "@/lib/actions"
import { subirYRegistrarSoporte } from "@/lib/soportes-actions"
import {
  getEquiposMontacargas,
  getMontacargasAlquiler,
  guardarMontacargasAlquiler,
  getCargosFijosProyecto,
  guardarCargoFijoProyecto,
  generarCargosDelMes,
  getCargosFijosGenerados,
  marcarCargoSolicitado,
  adjuntarFacturaSiigoCargo,
  quitarFacturaSiigoCargo,
  getComparativoToneladasFijas,
  type MontacargasAlquilerRow,
  type CargoFijoProyectoRow,
  type CargoFijoGenerado,
  type ComparativoToneladasFijas,
} from "@/lib/cargos-fijos-actions"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")
const ton = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { minimumFractionDigits: 3, maximumFractionDigits: 3 })

function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

function CategoriaBadge({ c }: { c: CargoFijoGenerado["categoria"] }) {
  if (c === "facturado") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Facturado</Badge>
  if (c === "en_proceso") return <Badge variant="outline" className="border-amber-400 text-amber-700">En proceso</Badge>
  return <Badge variant="outline" className="border-red-400 text-red-700">Sin gestionar</Badge>
}

// ---------------------------------------------------------------------------
// Configuración — Alquiler de montacargas
// ---------------------------------------------------------------------------

function ConfigMontacargas({ empresas }: { empresas: Array<{ id: number; nombre: string }> }) {
  const { toast } = useToast()
  const [filas, setFilas] = useState<MontacargasAlquilerRow[]>([])
  const [equipos, setEquipos] = useState<Array<{ id: number; idempresa: number; identificacion: string }>>([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState<MontacargasAlquilerRow | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [filtroEmpresa, setFiltroEmpresa] = useState(0) // 0 = todos los proyectos

  const cargar = useCallback(async () => {
    setLoading(true)
    const [r1, r2] = await Promise.all([getMontacargasAlquiler(), getEquiposMontacargas()])
    if (r1.success) setFilas(r1.data)
    if (r2.success) setEquipos(r2.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const nombreEmpresa = (id: number) => empresas.find((e) => e.id === id)?.nombre || `Empresa ${id}`
  const filasFiltradas = filtroEmpresa ? filas.filter((f) => f.idempresa === filtroEmpresa) : filas

  const abrirEdicion = (f: MontacargasAlquilerRow | null) => {
    setEditando(
      f ?? {
        id: 0,
        equipo_id: equipos[0]?.id ?? 0,
        idempresa: equipos[0]?.idempresa ?? 0,
        identificacion: equipos[0]?.identificacion ?? "",
        proveedor: "",
        valor_pagado: 0,
        valor_facturado: 0,
        fechainicio: `${hoyISO().slice(0, 4)}-01-01`,
        fechafin: `${hoyISO().slice(0, 4)}-12-31`,
      },
    )
    setAbierto(true)
  }

  const guardar = async () => {
    if (!editando) return
    setGuardando(true)
    const r = await guardarMontacargasAlquiler({
      id: editando.id || undefined,
      equipo_id: editando.equipo_id,
      proveedor: editando.proveedor,
      valor_pagado: editando.valor_pagado,
      valor_facturado: editando.valor_facturado,
      fechainicio: editando.fechainicio,
      fechafin: editando.fechafin,
    })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Guardado" })
      setAbierto(false)
      cargar()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Truck className="h-4 w-4" /> Alquiler de montacargas
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={String(filtroEmpresa)} onValueChange={(v) => setFiltroEmpresa(Number(v))}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Todos los proyectos</SelectItem>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={cargar} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => abrirEdicion(null)}>
            + Nueva vigencia
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>Proyecto</TableHead>
                <TableHead>Equipo</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right">Se paga</TableHead>
                <TableHead className="text-right">Se factura</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filasFiltradas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs">{nombreEmpresa(f.idempresa)}</TableCell>
                  <TableCell className="text-xs font-mono">{f.identificacion}</TableCell>
                  <TableCell className="text-xs">{f.proveedor}</TableCell>
                  <TableCell className="text-right text-xs">{money(f.valor_pagado)}</TableCell>
                  <TableCell className="text-right text-xs">
                    {f.valor_facturado === null ? (
                      <span className="text-muted-foreground">embebido (no aparte)</span>
                    ) : (
                      money(f.valor_facturado)
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {f.fechainicio} → {f.fechafin}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => abrirEdicion(f)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filasFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                    Sin configuración todavía.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar vigencia" : "Nueva vigencia de alquiler"}</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Equipo</Label>
                <Select
                  value={String(editando.equipo_id)}
                  onValueChange={(v) => {
                    const eq = equipos.find((e) => e.id === Number(v))
                    setEditando({ ...editando, equipo_id: Number(v), idempresa: eq?.idempresa ?? editando.idempresa, identificacion: eq?.identificacion ?? "" })
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {equipos.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {nombreEmpresa(e.idempresa)} · {e.identificacion}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Proveedor</Label>
                <Input value={editando.proveedor} onChange={(e) => setEditando({ ...editando, proveedor: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Se paga (mensual)</Label>
                  <Input
                    type="number"
                    value={editando.valor_pagado}
                    onChange={(e) => setEditando({ ...editando, valor_pagado: Number(e.target.value) })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Se factura (mensual) — vacío si va embebido</Label>
                  <Input
                    type="number"
                    value={editando.valor_facturado ?? ""}
                    onChange={(e) =>
                      setEditando({ ...editando, valor_facturado: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Vigente desde</Label>
                  <DatePickerField value={editando.fechainicio} onChange={(value) => setEditando({ ...editando, fechainicio: value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Vigente hasta</Label>
                  <DatePickerField value={editando.fechafin} onChange={(value) => setEditando({ ...editando, fechafin: value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Configuración — Cargos fijos del proyecto
// ---------------------------------------------------------------------------

function ConfigProyecto({ empresas }: { empresas: Array<{ id: number; nombre: string }> }) {
  const { toast } = useToast()
  const [filas, setFilas] = useState<CargoFijoProyectoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const [editando, setEditando] = useState<CargoFijoProyectoRow | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [filtroEmpresa, setFiltroEmpresa] = useState(0) // 0 = todos los proyectos

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await getCargosFijosProyecto()
    if (r.success) setFilas(r.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const nombreEmpresa = (id: number) => empresas.find((e) => e.id === id)?.nombre || `Empresa ${id}`
  const filasFiltradas = filtroEmpresa ? filas.filter((f) => f.idempresa === filtroEmpresa) : filas

  const abrirEdicion = (f: CargoFijoProyectoRow | null) => {
    setEditando(
      f ?? {
        id: 0,
        idempresa: empresas[0]?.id ?? 0,
        concepto: "",
        cantidad: null,
        tarifa: null,
        valor: 0,
        tipo: "ingreso",
        fechainicio: `${hoyISO().slice(0, 4)}-01-01`,
        fechafin: `${hoyISO().slice(0, 4)}-12-31`,
        valorMensual: 0,
      },
    )
    setAbierto(true)
  }

  const esFijo = editando ? editando.cantidad === null && editando.tarifa === null : true

  const guardar = async () => {
    if (!editando) return
    setGuardando(true)
    const r = await guardarCargoFijoProyecto({
      id: editando.id || undefined,
      idempresa: editando.idempresa,
      concepto: editando.concepto,
      cantidad: esFijo ? null : editando.cantidad,
      tarifa: esFijo ? null : editando.tarifa,
      valor: esFijo ? editando.valor : null,
      tipo: editando.tipo,
      fechainicio: editando.fechainicio,
      fechafin: editando.fechafin,
    })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Guardado" })
      setAbierto(false)
      cargar()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Landmark className="h-4 w-4" /> Cargos fijos del proyecto
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={String(filtroEmpresa)} onValueChange={(v) => setFiltroEmpresa(Number(v))}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Todos los proyectos</SelectItem>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={cargar} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
          <Button size="sm" variant="outline" onClick={() => abrirEdicion(null)}>
            + Nuevo concepto
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>Proyecto</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Cantidad × tarifa</TableHead>
                <TableHead className="text-right">Valor mensual</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filasFiltradas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs">{nombreEmpresa(f.idempresa)}</TableCell>
                  <TableCell className="text-xs">{f.concepto}</TableCell>
                  <TableCell className="text-xs capitalize">{f.tipo}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {f.cantidad !== null ? `${f.cantidad} × ${money(f.tarifa || 0)}` : "fijo"}
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold">{money(f.valorMensual)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {f.fechainicio} → {f.fechafin}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => abrirEdicion(f)}>
                      Editar
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filasFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                    Sin configuración todavía.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar cargo fijo" : "Nuevo cargo fijo"}</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Proyecto</Label>
                  <Select value={String(editando.idempresa)} onValueChange={(v) => setEditando({ ...editando, idempresa: Number(v) })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {empresas.map((e) => (
                        <SelectItem key={e.id} value={String(e.id)}>
                          {e.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={editando.tipo} onValueChange={(v) => setEditando({ ...editando, tipo: v as "ingreso" | "gasto" })}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ingreso">Ingreso</SelectItem>
                      <SelectItem value="gasto">Gasto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Concepto</Label>
                <Input value={editando.concepto} onChange={(e) => setEditando({ ...editando, concepto: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!esFijo}
                  onChange={(e) =>
                    setEditando(
                      e.target.checked
                        ? { ...editando, cantidad: editando.cantidad ?? 0, tarifa: editando.tarifa ?? 0, valor: null }
                        : { ...editando, cantidad: null, tarifa: null, valor: editando.valor ?? 0 },
                    )
                  }
                />
                Es cantidad × tarifa (en vez de un monto fijo directo)
              </div>
              {esFijo ? (
                <div className="grid gap-1.5">
                  <Label className="text-xs">Valor mensual fijo</Label>
                  <Input type="number" value={editando.valor ?? 0} onChange={(e) => setEditando({ ...editando, valor: Number(e.target.value) })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Cantidad</Label>
                    <Input type="number" value={editando.cantidad ?? 0} onChange={(e) => setEditando({ ...editando, cantidad: Number(e.target.value) })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Tarifa</Label>
                    <Input type="number" value={editando.tarifa ?? 0} onChange={(e) => setEditando({ ...editando, tarifa: Number(e.target.value) })} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Vigente desde</Label>
                  <DatePickerField value={editando.fechainicio} onChange={(value) => setEditando({ ...editando, fechainicio: value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Vigente hasta</Label>
                  <DatePickerField value={editando.fechafin} onChange={(value) => setEditando({ ...editando, fechafin: value })} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Vista mensual — generar + rastrear
// ---------------------------------------------------------------------------

function VistaMensual({ empresas }: { empresas: Array<{ id: number; nombre: string }> }) {
  const { toast } = useToast()
  const [periodo, setPeriodo] = useState(hoyISO().slice(0, 7))
  const [empresaId, setEmpresaId] = useState<number | null>(null)
  const [data, setData] = useState<CargoFijoGenerado[]>([])
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [comparativo, setComparativo] = useState<ComparativoToneladasFijas | null>(null)
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({})

  const nombreEmpresa = (id: number) => empresas.find((e) => e.id === id)?.nombre || `Empresa ${id}`

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await getCargosFijosGenerados(empresaId, `${periodo}-01`)
    if (r.success) setData(r.data)
    else toast({ title: "Error", description: r.message, variant: "destructive" })
    setLoading(false)

    // Comparativo toneladas fijas vs reales: hoy solo aplica a Avimol (ID2,
    // Distribución fija). Puramente informativo — el fijo se cobra completo
    // sin importar el real; no afecta valor/estado de ningún cargo.
    if (empresaId === 2) {
      const rc = await getComparativoToneladasFijas(2, `${periodo}-01`)
      setComparativo(rc.success ? rc.data ?? null : null)
    } else {
      setComparativo(null)
    }
  }, [empresaId, periodo, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const generar = async () => {
    setGenerando(true)
    const r = await generarCargosDelMes(`${periodo}-01`)
    setGenerando(false)
    if (r.success && r.data) {
      toast({ title: "Cargos generados", description: `${r.data.creados} nuevo(s) · ${r.data.yaExistian} ya existían` })
      cargar()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  const subirFactura = async (id: number, file: File) => {
    const r = await subirYRegistrarSoporte(file, {
      modulo: "Cargos Fijos",
      referenciaTipo: "cargo_fijo",
      referenciaId: String(id),
      norma: "cargos_fijos",
    })
    if (!r.success || !r.url) {
      toast({ title: "Error", description: r.message, variant: "destructive" })
      return
    }
    const r2 = await adjuntarFacturaSiigoCargo(id, r.url)
    if (r2.success) {
      toast({ title: "Factura adjuntada" })
      cargar()
    } else {
      toast({ title: "Error", description: r2.message, variant: "destructive" })
    }
  }

  const totalIngreso = data.filter((d) => d.tipo === "ingreso").reduce((a, d) => a + d.valor, 0)
  const totalGasto = data.filter((d) => d.tipo === "gasto").reduce((a, d) => a + d.valor, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs">Mes</Label>
            <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Proyecto</Label>
            <Select value={empresaId ? String(empresaId) : "todos"} onValueChange={(v) => setEmpresaId(v === "todos" ? null : Number(v))}>
              <SelectTrigger className="h-9 w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los proyectos</SelectItem>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={cargar}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refrescar
          </Button>
          <Button size="sm" onClick={generar} disabled={generando} className="ml-auto">
            {generando && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Generar cargos del mes
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="text-[11px] text-muted-foreground">Ingreso fijo del mes</div>
            <div className="text-lg font-bold text-emerald-700">{money(totalIngreso)}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-[11px] text-muted-foreground">Gasto fijo del mes</div>
            <div className="text-lg font-bold">{money(totalGasto)}</div>
          </div>
        </div>

        {comparativo && comparativo.toneladasFijas > 0 && (
          <div className="rounded-md border border-dashed p-3">
            <div className="text-[11px] text-muted-foreground">
              Distribución Avimol — toneladas fijas vs reales del mes (solo informativo: el fijo se cobra completo, no importa el real)
            </div>
            <div className="mt-1 flex items-baseline gap-4">
              <span className="text-sm">
                Fijas: <strong>{ton(comparativo.toneladasFijas)} t</strong>
              </span>
              <span className="text-sm">
                Reales: <strong>{ton(comparativo.toneladasReales)} t</strong>
              </span>
              <span className={`text-xs ${comparativo.toneladasReales >= comparativo.toneladasFijas ? "text-emerald-700" : "text-amber-700"}`}>
                {comparativo.toneladasReales >= comparativo.toneladasFijas
                  ? "el real cubre o supera el fijo"
                  : `el real quedó ${ton(comparativo.toneladasFijas - comparativo.toneladasReales)} t por debajo del fijo`}
              </span>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="text-[11px]">
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs">{nombreEmpresa(d.idempresa)}</TableCell>
                    <TableCell className="text-xs">{d.concepto}</TableCell>
                    <TableCell className="text-xs capitalize">{d.tipo}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{money(d.valor)}</TableCell>
                    <TableCell>
                      <CategoriaBadge c={d.categoria} />
                    </TableCell>
                    <TableCell className="text-right">
                      {d.tipo === "ingreso" &&
                        (d.categoria === "facturado" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={async () => {
                              const r = await quitarFacturaSiigoCargo(d.id)
                              if (r.success) cargar()
                              else toast({ title: "Error", description: r.message, variant: "destructive" })
                            }}
                          >
                            <X className="mr-1 h-3.5 w-3.5" /> Quitar factura
                          </Button>
                        ) : (
                          <>
                            {d.categoria === "sin_gestionar" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  const r = await marcarCargoSolicitado(d.id)
                                  if (r.success) cargar()
                                }}
                              >
                                Marcar solicitada
                              </Button>
                            )}
                            <input
                              ref={(el) => {
                                fileInputs.current[d.id] = el
                              }}
                              type="file"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) subirFactura(d.id, f)
                                e.target.value = ""
                              }}
                            />
                            <Button size="sm" variant="ghost" onClick={() => fileInputs.current[d.id]?.click()}>
                              <Upload className="mr-1 h-3.5 w-3.5" /> Subir factura
                            </Button>
                          </>
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
                {data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                      Nada generado para este mes todavía — usa "Generar cargos del mes".
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Contenedor
// ---------------------------------------------------------------------------

export default function CargosFijos() {
  const [empresas, setEmpresas] = useState<Array<{ id: number; nombre: string }>>([])
  const [tab, setTab] = useState<"mensual" | "config">("mensual")

  useEffect(() => {
    getAllEmpresas().then(setEmpresas)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Cargos Fijos</h1>
        <div className="flex rounded-md border">
          <Button variant={tab === "mensual" ? "default" : "ghost"} size="sm" className="rounded-r-none" onClick={() => setTab("mensual")}>
            Del mes
          </Button>
          <Button variant={tab === "config" ? "default" : "ghost"} size="sm" className="rounded-l-none" onClick={() => setTab("config")}>
            <Settings className="mr-1.5 h-3.5 w-3.5" /> Configuración
          </Button>
        </div>
      </div>

      {tab === "mensual" ? (
        <VistaMensual empresas={empresas} />
      ) : (
        <div className="space-y-4">
          <ConfigMontacargas empresas={empresas} />
          <ConfigProyecto empresas={empresas} />
        </div>
      )}
    </div>
  )
}
