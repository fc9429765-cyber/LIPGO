"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import {
  Palmtree,
  Plus,
  Search,
  Loader2,
  CalendarClock,
  Wallet,
  AlertTriangle,
  Check,
  X,
  RefreshCw,
} from "lucide-react"
import {
  getVacacionesResumen,
  getSolicitudesVacaciones,
  crearSolicitudVacaciones,
  aprobarSolicitudVacaciones,
  rechazarSolicitudVacaciones,
  registrarLiquidacionVacaciones,
  getFestivos,
} from "@/lib/vacaciones-actions"
import { diasHabilesEntre, type VacacionResumen, type SolicitudVacaciones } from "@/lib/vacaciones-types"
import { useClaveAccion } from "@/components/clave-accion-provider"

const fmtCOP = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-CO")

export default function Vacaciones() {
  const { selectedEmpresaId, profile } = useAuth()
  const { toast } = useToast()
  const { conClave } = useClaveAccion()
  const [resumen, setResumen] = useState<VacacionResumen[]>([])
  const [solicitudes, setSolicitudes] = useState<SolicitudVacaciones[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [festivos, setFestivos] = useState<string[]>([])

  // Diálogo de solicitud
  const [openSol, setOpenSol] = useState(false)
  const [savingSol, setSavingSol] = useState(false)
  const [solForm, setSolForm] = useState({ cedula: "", nombre: "", cargo: "", fecha_inicio: "", fecha_fin: "", observaciones: "" })

  // Diálogo de liquidación
  const [openLiq, setOpenLiq] = useState(false)
  const [savingLiq, setSavingLiq] = useState(false)
  const [liqForm, setLiqForm] = useState({ cedula: "", nombre: "", dias: "", valor_dia: "", observaciones: "" })

  const loadData = async () => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([
        getVacacionesResumen(selectedEmpresaId),
        getSolicitudesVacaciones(selectedEmpresaId),
      ])
      setResumen(r)
      setSolicitudes(s)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEmpresaId])

  useEffect(() => {
    getFestivos().then(setFestivos).catch(() => setFestivos([]))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return resumen
    return resumen.filter((r) => r.nombre.toLowerCase().includes(q) || (r.cedula || "").toLowerCase().includes(q))
  }, [resumen, search])

  const kpis = useMemo(() => {
    const saldoTotal = resumen.reduce((s, r) => s + Math.max(0, r.saldo), 0)
    const valorTotal = resumen.reduce((s, r) => s + r.valor_saldo, 0)
    const conAlerta = resumen.filter((r) => r.alerta !== "ok").length
    return { trabajadores: resumen.length, saldoTotal: Math.round(saldoTotal * 10) / 10, valorTotal, conAlerta }
  }, [resumen])

  const diasSolicitud = useMemo(
    () => (solForm.fecha_inicio && solForm.fecha_fin ? diasHabilesEntre(solForm.fecha_inicio, solForm.fecha_fin, festivos).length : 0),
    [solForm.fecha_inicio, solForm.fecha_fin, festivos],
  )

  const abrirSolicitud = (r?: VacacionResumen) => {
    setSolForm({
      cedula: r?.cedula || "",
      nombre: r?.nombre || "",
      cargo: r?.cargo || "",
      fecha_inicio: "",
      fecha_fin: "",
      observaciones: "",
    })
    setOpenSol(true)
  }

  const abrirLiquidacion = (r: VacacionResumen) => {
    setLiqForm({
      cedula: r.cedula,
      nombre: r.nombre,
      dias: r.saldo > 0 ? String(r.saldo) : "",
      valor_dia: String(r.valor_dia),
      observaciones: "",
    })
    setOpenLiq(true)
  }

  const guardarSolicitud = async () => {
    if (!solForm.cedula || !solForm.fecha_inicio || !solForm.fecha_fin) {
      toast({ title: "Faltan datos", description: "Colaborador y fechas son obligatorios." })
      return
    }
    setSavingSol(true)
    try {
      const r = await crearSolicitudVacaciones(solForm, selectedEmpresaId)
      if (r.success) {
        toast({ title: "Solicitud creada", description: `${r.dias} días hábiles.` })
        setOpenSol(false)
        loadData()
      } else {
        toast({ title: "Error", description: r.message })
      }
    } finally {
      setSavingSol(false)
    }
  }

  const guardarLiquidacion = async () => {
    const dias = Number(liqForm.dias)
    if (!liqForm.cedula || !dias || dias <= 0) {
      toast({ title: "Datos inválidos", description: "Indica los días a liquidar." })
      return
    }
    setSavingLiq(true)
    try {
      const r = await conClave("Vacaciones", "cerrar", (clave) =>
        registrarLiquidacionVacaciones(
          { cedula: liqForm.cedula, nombre: liqForm.nombre, dias, valor_dia: Number(liqForm.valor_dia) || 0, observaciones: liqForm.observaciones },
          selectedEmpresaId,
          clave,
        ),
      )
      if (r.success) {
        toast({ title: "Liquidación registrada", description: fmtCOP(r.total || 0) })
        setOpenLiq(false)
        loadData()
      } else {
        toast({ title: "Error", description: r.message })
      }
    } finally {
      setSavingLiq(false)
    }
  }

  const aprobar = async (s: SolicitudVacaciones) => {
    const r = await aprobarSolicitudVacaciones(s.id, profile?.usuario || undefined)
    if (r.success) {
      toast({ title: "Vacaciones aprobadas", description: `${r.dias} días registrados en el control diario.` })
      loadData()
    } else {
      toast({ title: "Error", description: r.message })
    }
  }

  const rechazar = async (s: SolicitudVacaciones) => {
    const motivo = window.prompt("Motivo del rechazo (opcional):") ?? undefined
    const r = await rechazarSolicitudVacaciones(s.id, motivo)
    if (r.success) {
      toast({ title: "Solicitud rechazada" })
      loadData()
    } else {
      toast({ title: "Error", description: r.message })
    }
  }

  const alertaBadge = (a: VacacionResumen["alerta"]) =>
    a === "crit"
      ? "bg-red-100 text-red-800"
      : a === "warn"
        ? "bg-amber-100 text-amber-800"
        : "bg-green-100 text-green-800"

  const estadoBadge = (e: string) =>
    e === "APROBADA"
      ? "bg-green-100 text-green-800"
      : e === "RECHAZADA"
        ? "bg-red-100 text-red-800"
        : "bg-amber-100 text-amber-800"

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Palmtree className="h-6 w-6 text-emerald-600" />
        <div>
          <h1 className="text-xl font-bold text-foreground">Vacaciones</h1>
          <p className="text-[13px] text-muted-foreground">
            Causación (15 días hábiles/año), disfrute, saldo y liquidación por trabajador.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold tabular-nums">{kpis.trabajadores}</div>
            <div className="text-[11px] text-muted-foreground">Trabajadores activos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold tabular-nums">{kpis.saldoTotal}</div>
            <div className="text-[11px] text-muted-foreground">Saldo total (días)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold tabular-nums">{fmtCOP(kpis.valorTotal)}</div>
            <div className="text-[11px] text-muted-foreground">Valor del saldo</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-lg font-bold tabular-nums text-amber-600">{kpis.conAlerta}</div>
            <div className="text-[11px] text-muted-foreground">Con acumulación alta</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="saldos" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="saldos" className="gap-2">
              <Wallet className="h-4 w-4" />
              Saldos
            </TabsTrigger>
            <TabsTrigger value="solicitudes" className="gap-2">
              <CalendarClock className="h-4 w-4" />
              Solicitudes
              {solicitudes.some((s) => s.estado === "PENDIENTE") && (
                <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {solicitudes.filter((s) => s.estado === "PENDIENTE").length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <Button onClick={() => abrirSolicitud()} className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva solicitud
            </Button>
          </div>
        </div>

        {/* SALDOS */}
        <TabsContent value="saldos" className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar colaborador o cédula..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Ingreso</TableHead>
                  <TableHead className="text-center">Antigüedad</TableHead>
                  <TableHead className="text-center">Causados</TableHead>
                  <TableHead className="text-center">Disfrutados</TableHead>
                  <TableHead className="text-center">Programados</TableHead>
                  <TableHead className="text-center">Saldo</TableHead>
                  <TableHead className="text-right">Valor saldo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      No hay trabajadores activos.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.cedula} className={r.alerta === "crit" ? "bg-red-50" : r.alerta === "warn" ? "bg-amber-50" : ""}>
                      <TableCell>
                        <div className="font-medium">{r.nombre}</div>
                        <div className="text-[11px] text-muted-foreground">{r.cedula}</div>
                      </TableCell>
                      <TableCell>{r.fecha_ingreso || "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">{r.anios ? `${r.anios} a` : "—"}</TableCell>
                      <TableCell className="text-center tabular-nums">{r.causados}</TableCell>
                      <TableCell className="text-center tabular-nums">{r.disfrutados}</TableCell>
                      <TableCell className="text-center tabular-nums">{r.programados || 0}</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${alertaBadge(r.alerta)}`}>
                          {r.saldo}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtCOP(r.valor_saldo)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => abrirSolicitud(r)}>
                            Solicitar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => abrirLiquidacion(r)} disabled={r.saldo <= 0}>
                            Liquidar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* SOLICITUDES */}
        <TabsContent value="solicitudes">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Hasta</TableHead>
                  <TableHead className="text-center">Días háb.</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Aprobó</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : solicitudes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      No hay solicitudes.
                    </TableCell>
                  </TableRow>
                ) : (
                  solicitudes.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">{s.nombre || s.cedula}</div>
                        <div className="text-[11px] text-muted-foreground">{s.cedula}</div>
                      </TableCell>
                      <TableCell>{String(s.fecha_inicio).slice(0, 10)}</TableCell>
                      <TableCell>{String(s.fecha_fin).slice(0, 10)}</TableCell>
                      <TableCell className="text-center tabular-nums">{s.dias_habiles}</TableCell>
                      <TableCell>
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${estadoBadge(s.estado)}`}>
                          {s.estado}
                        </span>
                        {s.estado === "RECHAZADA" && s.motivo_rechazo && (
                          <div className="text-[11px] text-muted-foreground">{s.motivo_rechazo}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">{s.aprobado_por || "—"}</TableCell>
                      <TableCell>
                        {s.estado === "PENDIENTE" ? (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" onClick={() => aprobar(s)} className="gap-1 bg-emerald-600 hover:bg-emerald-700">
                              <Check className="h-4 w-4" /> Aprobar
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => rechazar(s)} className="gap-1">
                              <X className="h-4 w-4" /> Rechazar
                            </Button>
                          </div>
                        ) : (
                          <div className="text-right text-[11px] text-muted-foreground">—</div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Diálogo: nueva solicitud */}
      <Dialog open={openSol} onOpenChange={setOpenSol}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva solicitud de vacaciones</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Colaborador</Label>
              <Select
                value={solForm.cedula}
                onValueChange={(v) => {
                  const r = resumen.find((x) => x.cedula === v)
                  setSolForm((f) => ({ ...f, cedula: v, nombre: r?.nombre || "", cargo: r?.cargo || "" }))
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un trabajador" />
                </SelectTrigger>
                <SelectContent>
                  {resumen.map((r) => (
                    <SelectItem key={r.cedula} value={r.cedula}>
                      {r.nombre} · saldo {r.saldo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Desde</Label>
                <DatePickerField value={solForm.fecha_inicio} onChange={(value) => setSolForm({ ...solForm, fecha_inicio: value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Hasta</Label>
                <DatePickerField value={solForm.fecha_fin} onChange={(value) => setSolForm({ ...solForm, fecha_fin: value })} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Días hábiles (lun–sáb, sin festivos): <strong className="text-foreground">{diasSolicitud}</strong>
            </div>
            <div className="space-y-1.5">
              <Label>Observaciones</Label>
              <Textarea rows={2} value={solForm.observaciones} onChange={(e) => setSolForm({ ...solForm, observaciones: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSol(false)} disabled={savingSol}>
              Cancelar
            </Button>
            <Button onClick={guardarSolicitud} disabled={savingSol}>
              {savingSol && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear solicitud
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: liquidación */}
      <Dialog open={openLiq} onOpenChange={setOpenLiq}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liquidar vacaciones — {liqForm.nombre}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Días a liquidar</Label>
                <Input type="number" step="0.5" value={liqForm.dias} onChange={(e) => setLiqForm({ ...liqForm, dias: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Valor día</Label>
                <Input type="number" value={liqForm.valor_dia} onChange={(e) => setLiqForm({ ...liqForm, valor_dia: e.target.value })} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Total: <strong className="text-foreground">{fmtCOP((Number(liqForm.dias) || 0) * (Number(liqForm.valor_dia) || 0))}</strong>
            </div>
            <div className="space-y-1.5">
              <Label>Observaciones</Label>
              <Textarea rows={2} value={liqForm.observaciones} onChange={(e) => setLiqForm({ ...liqForm, observaciones: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenLiq(false)} disabled={savingLiq}>
              Cancelar
            </Button>
            <Button onClick={guardarLiquidacion} disabled={savingLiq}>
              {savingLiq && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar liquidación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
