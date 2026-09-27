"use client"

// Compensación › Bonos.
// Registra bonos OPERATIVOS y ADMINISTRATIVOS por día y por persona, con su
// concepto y su novedad de Siigo. Nacen PENDIENTES: solo al aprobarse entran a
// pagonomina (bonif_no_prestacional) y salen en el archivo plano.
// Son NO prestacionales: no cotizan al IBC ni generan prestaciones.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, Briefcase, Check, ChevronsUpDown, Eye, EyeOff, Gift, Loader2, Lock, Trash2, Users, X } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  getColaboradoresBonos,
  registrarBono,
  aprobarBono,
  rechazarBono,
  eliminarBono,
  getBonos,
  verificarClaveBonos,
  type ColaboradorBono,
  type BonoRow,
  type BonosResumen,
} from "@/lib/bonos-actions"
import { getAllEmpresas } from "@/lib/actions"
import { NOVEDADES_BONO, TIPOS_BONO, type TipoBono, type EstadoBono } from "@/lib/bonos-constants"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")

function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date())
}

const ESTADO_CLASS: Record<EstadoBono, string> = {
  pendiente: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  aprobado: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rechazado: "bg-destructive/15 text-destructive",
}

export default function Bonos() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gift className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-semibold">Bonos</h1>
          <p className="text-sm text-muted-foreground">
            Bonos operativos y administrativos por día y por persona. Al aprobarse suman en la nómina y salen en el
            archivo plano con su novedad de Siigo.
          </p>
        </div>
      </div>

      <Tabs defaultValue="registrar" className="w-full">
        <TabsList>
          <TabsTrigger value="registrar">Registrar</TabsTrigger>
          <TabsTrigger value="listado">Aprobación y consulta</TabsTrigger>
        </TabsList>
        <TabsContent value="registrar" className="mt-4">
          <RegistrarBonoTab />
        </TabsContent>
        <TabsContent value="listado" className="mt-4">
          <ListadoBonosTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Picker de colaborador. Vive a nivel de módulo a propósito: si se definiera
 * dentro del formulario, React lo remontaría en cada tecla y el buscador
 * perdería el foco. El campo inactivo se deshabilita, no se oculta, para que se
 * vea de un golpe cuál de los dos gobierna el Tipo.
 */
function PickerColaborador({
  activo,
  items,
  valorSel,
  setValorSel,
  open,
  setOpen,
  placeholder,
  vacio,
}: {
  activo: boolean
  items: ColaboradorBono[]
  valorSel: string
  setValorSel: (v: string) => void
  open: boolean
  setOpen: (v: boolean) => void
  placeholder: string
  vacio: string
}) {
  return (
    <Popover open={activo && open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={!activo}
          className="w-full justify-between font-normal disabled:opacity-50"
        >
          <span className="flex items-center gap-2 truncate">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{valorSel || placeholder}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Buscar colaborador…" />
          <CommandList>
            <CommandEmpty>{vacio}</CommandEmpty>
            <CommandGroup>
              {items.map((c) => (
                <CommandItem
                  key={c.nombre}
                  value={c.nombre}
                  onSelect={() => {
                    setValorSel(c.nombre)
                    setOpen(false)
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${valorSel === c.nombre ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1 truncate">{c.nombre}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.estado}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Registrar
// ---------------------------------------------------------------------------
function RegistrarBonoTab() {
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth() as any
  const empresaId: number | null = selectedEmpresaId != null ? Number(selectedEmpresaId) : null
  // Dos listados independientes, igual que las pestañas de Head Count:
  //   · operativos     = los del proyecto del selector global (centro de costo).
  //   · administrativos = headcount.admin = true, transversales a todo LIP.
  const [operativos, setOperativos] = useState<ColaboradorBono[]>([])
  const [administrativos, setAdministrativos] = useState<ColaboradorBono[]>([])
  const [personaOp, setPersonaOp] = useState("")
  const [personaAdm, setPersonaAdm] = useState("")
  const [openOp, setOpenOp] = useState(false)
  const [openAdm, setOpenAdm] = useState(false)
  const [fecha, setFecha] = useState(hoyISO())
  const [tipo, setTipo] = useState<TipoBono>("Operativo")
  const [concepto, setConcepto] = useState("")
  const [novedad, setNovedad] = useState<string>(NOVEDADES_BONO[0].nombre)
  const [valor, setValor] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El Tipo es el interruptor: decide cuál de los dos campos queda habilitado, y
  // cuál colaborador viaja al registro. Así no se puede mandar un bono
  // Administrativo a un operario ni al revés.
  const esAdm = tipo === "Administrativo"
  const persona = esAdm ? personaAdm : personaOp
  const lista = esAdm ? administrativos : operativos

  // Los operativos dependen del selector global: al cambiar de proyecto se
  // recarga la lista y se limpia el elegido si ya no pertenece.
  useEffect(() => {
    getColaboradoresBonos("operativo", empresaId).then((r) => {
      if (r.success) {
        setOperativos(r.data)
        setPersonaOp((p) => (r.data.some((c) => c.nombre === p) ? p : ""))
      } else {
        toast({ title: "No se pudieron cargar los colaboradores", description: r.message, variant: "destructive" })
      }
    })
  }, [empresaId, toast])

  // Los administrativos tambien pertenecen a un proyecto, asi que se recargan
  // al cambiar de proyecto igual que los operativos. Los que no tengan proyecto
  // asignado se incluyen en todos (ver getColaboradoresBonos).
  useEffect(() => {
    getColaboradoresBonos("administrativo", empresaId).then((r) => {
      if (r.success) setAdministrativos(r.data)
      else toast({ title: "No se pudo cargar el personal administrativo", description: r.message, variant: "destructive" })
    })
  }, [empresaId, toast])

  const seleccionado = useMemo(() => lista.find((c) => c.nombre === persona), [lista, persona])

  const guardar = useCallback(async () => {
    setGuardando(true)
    setError(null)
    const r = await registrarBono({
      nombre: persona,
      fecha,
      tipo,
      concepto,
      novedadSiigo: novedad,
      valor: Number(valor.replace(/[^\d.-]/g, "")),
    })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Bono registrado", description: "Queda PENDIENTE de aprobación; aún no impacta la nómina." })
      setConcepto("")
      setValor("")
    } else {
      setError(r.message || "No se pudo registrar el bono.")
      toast({ title: "No se pudo registrar el bono", description: r.message, variant: "destructive" })
    }
  }, [persona, fecha, tipo, concepto, novedad, valor, toast])

  const puedeGuardar = persona && fecha && concepto.trim() && Number(valor.replace(/[^\d.-]/g, "")) > 0


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Nuevo bono</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* El Tipo va primero porque es el INTERRUPTOR: decide cuál de los dos
              campos de colaborador queda habilitado. */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Tipo de bono</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoBono)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_BONO.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Habilita el campo de colaborador correspondiente. El cálculo y el pago son idénticos en ambos.
              </p>
            </div>

            <div className="space-y-1">
              <Label>Fecha del bono</Label>
              <DatePickerField value={fecha} onChange={setFecha} />
            </div>

            <div className={`space-y-1 ${esAdm ? "opacity-50" : ""}`}>
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Colaborador operativo
              </Label>
              <PickerColaborador
                activo={!esAdm}
                items={operativos}
                valorSel={personaOp}
                setValorSel={setPersonaOp}
                open={openOp}
                setOpen={setOpenOp}
                placeholder="Selecciona un colaborador…"
                vacio="Sin resultados en este proyecto."
              />
              <p className="text-xs text-muted-foreground">
                Personal de{" "}
                <strong>{selectedEmpresaNombre || (empresaId != null ? `emp${empresaId}` : "todos los proyectos")}</strong>{" "}
                ({operativos.length}) — sigue el selector global de proyecto.
              </p>
            </div>

            <div className={`space-y-1 ${esAdm ? "" : "opacity-50"}`}>
              <Label className="flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5" /> Colaborador administrativo
              </Label>
              <PickerColaborador
                activo={esAdm}
                items={administrativos}
                valorSel={personaAdm}
                setValorSel={setPersonaAdm}
                open={openAdm}
                setOpen={setOpenAdm}
                placeholder="Selecciona un administrativo…"
                vacio="Nadie marcado como administrativo en Head Count."
              />
              <p className="text-xs text-muted-foreground">
                Todo el personal administrativo de LIP ({administrativos.length}) — transversal, no depende del
                proyecto.
              </p>
            </div>

            {seleccionado && (
              <p className="text-xs text-muted-foreground md:col-span-2">
                Seleccionado: <strong>{seleccionado.nombre}</strong> · CC {seleccionado.identificacion || "—"} ·{" "}
                {seleccionado.idempresa != null ? `emp${seleccionado.idempresa}` : "—"} · {seleccionado.estado}
                {seleccionado.cargo ? ` · ${seleccionado.cargo}` : ""}
              </p>
            )}

            {esAdm && administrativos.length === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm md:col-span-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span>
                  Todavía no hay nadie marcado como <strong>administrativo</strong> en Head Count. Márcalos en Gestión
                  Humana › Head Count (pestaña <em>Administrativo</em>) y aparecerán aquí.
                </span>
              </div>
            )}

            <div className="space-y-1">
              <Label>Novedad en Siigo</Label>
              <Select value={novedad} onValueChange={setNovedad}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOVEDADES_BONO.map((n) => (
                    <SelectItem key={n.codigo} value={n.nombre}>
                      {n.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Con esta novedad sale al archivo plano.</p>
            </div>

            <div className="space-y-1">
              <Label>Valor</Label>
              <Input
                type="number"
                min="0"
                step="1000"
                placeholder="0"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              {Number(valor) > 0 && (
                <p className="text-xs text-muted-foreground">{money(Number(valor))}</p>
              )}
            </div>

            <div className="space-y-1 md:col-span-2">
              <Label>Concepto</Label>
              <Textarea
                placeholder="Motivo del bono (queda registrado y visible en la aprobación)…"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={guardar} disabled={!puedeGuardar || guardando} className="min-w-[150px]">
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
              Registrar bono
            </Button>
            <p className="text-xs text-muted-foreground">
              Queda <strong>pendiente</strong>: no impacta la nómina hasta que se apruebe.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <div className="font-medium text-destructive">No se pudo registrar el bono</div>
                <div className="mt-1 text-muted-foreground">{error}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Los bonos son <strong>no prestacionales</strong>: se pagan al trabajador pero no cotizan a seguridad social
        (no entran al IBC de la PILA) ni sirven de base para cesantías, prima ni vacaciones.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aprobación y consulta
// ---------------------------------------------------------------------------
function ListadoBonosTab() {
  const { toast } = useToast()
  const hoy = hoyISO()
  const [desde, setDesde] = useState(hoy.slice(0, 8) + "01")
  const [hasta, setHasta] = useState(hoy)
  const [estado, setEstado] = useState<EstadoBono | "todos">("todos")
  const [tipo, setTipo] = useState<TipoBono | "todos">("todos")
  const [empresaFiltro, setEmpresaFiltro] = useState<number>(0) // 0 = todas
  const [empresas, setEmpresas] = useState<Array<{ id: number; nombre: string }>>([])
  const [rows, setRows] = useState<BonoRow[]>([])
  const [resumen, setResumen] = useState<BonosResumen | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [rechazando, setRechazando] = useState<number | null>(null)
  const [motivo, setMotivo] = useState("")
  // Clave de aprobación. Se pide UNA vez por sesión de pantalla (aprobar 20
  // bonos tecleándola 20 veces no lo usaría nadie) y queda solo en memoria:
  // nunca se guarda en localStorage ni viaja a otro lado. El servidor la
  // vuelve a validar en CADA aprobación, así que esto es comodidad, no el
  // control — el control está en la server action.
  const [clave, setClave] = useState("")
  const [claveOk, setClaveOk] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [claveError, setClaveError] = useState<string | null>(null)
  const [mostrarClave, setMostrarClave] = useState(false)

  const verificarClave = useCallback(async () => {
    setVerificando(true)
    setClaveError(null)
    const r = await verificarClaveBonos(clave)
    setVerificando(false)
    if (r.success) {
      setClaveOk(true)
      toast({ title: "Aprobación desbloqueada", description: "Ya puedes aprobar bonos en esta pantalla." })
    } else {
      setClaveOk(false)
      setClaveError(r.message || "Clave incorrecta.")
    }
  }, [clave, toast])

  const bloquear = useCallback(() => {
    setClaveOk(false)
    setClave("")
    setClaveError(null)
    setMostrarClave(false)
  }, [])

  const consultar = useCallback(async () => {
    setLoading(true)
    setError(null)
    const r = await getBonos({ desde, hasta, estado, tipo, empresa: empresaFiltro || undefined })
    setLoading(false)
    if (r.success) {
      setRows(r.data)
      setResumen(r.resumen || null)
    } else {
      setRows([])
      setResumen(null)
      setError(r.message || "Error al listar los bonos.")
      toast({ title: "No se pudieron cargar los bonos", description: r.message, variant: "destructive" })
    }
  }, [desde, hasta, estado, tipo, empresaFiltro, toast])

  useEffect(() => {
    getAllEmpresas().then(setEmpresas)
  }, [])

  useEffect(() => {
    consultar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const accion = async (id: number, fn: () => Promise<{ success: boolean; message?: string }>, ok: string) => {
    setUpdatingId(id)
    const r = await fn()
    setUpdatingId(null)
    if (r.success) {
      toast({ title: ok })
      setRechazando(null)
      setMotivo("")
      consultar()
    } else {
      toast({ title: "No se pudo completar la acción", description: r.message, variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="space-y-1">
            <Label>Desde</Label>
            <DatePickerField value={desde} onChange={setDesde} className="w-[160px]" />
          </div>
          <div className="space-y-1">
            <Label>Hasta</Label>
            <DatePickerField value={hasta} onChange={setHasta} className="w-[160px]" />
          </div>
          <div className="space-y-1">
            <Label>Proyecto</Label>
            <Select value={String(empresaFiltro)} onValueChange={(v) => setEmpresaFiltro(Number(v))}>
              <SelectTrigger className="w-[170px]">
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
          </div>
          <div className="space-y-1">
            <Label>Estado</Label>
            <Select value={estado} onValueChange={(v) => setEstado(v as EstadoBono | "todos")}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pendiente">Pendientes</SelectItem>
                <SelectItem value="aprobado">Aprobados</SelectItem>
                <SelectItem value="rechazado">Rechazados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoBono | "todos")}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {TIPOS_BONO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={consultar} disabled={loading} className="min-w-[130px]">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gift className="mr-2 h-4 w-4" />}
            Consultar
          </Button>
        </CardContent>
      </Card>

      {resumen && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Pendientes por aprobar" value={String(resumen.pendientes)} hint={money(resumen.valorPendiente)} tone={resumen.pendientes > 0 ? "warn" : undefined} />
          <Kpi label="Aprobados" value={String(resumen.aprobados)} hint={money(resumen.valorAprobado)} tone="ok" />
          <Kpi label="Rechazados" value={String(resumen.rechazados)} />
          <Kpi label="Personas" value={String(resumen.personas)} hint="con bonos en el periodo" />
        </div>
      )}

      {/* Clave de aprobación. Aprobar es lo que convierte el bono en plata
          pagada, así que va detrás de clave; el servidor la revalida en cada
          aprobación (esto solo desbloquea el botón). */}
      <Card className={claveOk ? "border-emerald-500/40" : "border-amber-500/40"}>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          {claveOk ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>
                  <strong>Aprobación desbloqueada.</strong> Los botones de aprobar están habilitados en esta pantalla.
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={bloquear} className="gap-1">
                <Lock className="h-3.5 w-3.5" /> Bloquear
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Tu clave de autorización
                </Label>
                <AyudaClaveAutorizacion />
                <div className="relative w-[200px]">
                  <Input
                    type={mostrarClave ? "text" : "password"}
                    value={clave}
                    onChange={(e) => {
                      setClave(e.target.value)
                      setClaveError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && clave) verificarClave()
                    }}
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                    onClick={() => setMostrarClave(!mostrarClave)}
                  >
                    {mostrarClave ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="sr-only">{mostrarClave ? "Ocultar clave" : "Mostrar clave"}</span>
                  </Button>
                </div>
              </div>
              <Button onClick={verificarClave} disabled={!clave || verificando} className="min-w-[130px]">
                {verificando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                Desbloquear
              </Button>
              <p className="flex-1 text-xs text-muted-foreground">
                Aprobar un bono lo mete a la nómina y al archivo plano. Sin la clave se puede consultar y rechazar,
                pero no aprobar.
              </p>
            </>
          )}
          {claveError && (
            <div className="flex w-full items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {claveError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bonos del periodo — {rows.length}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Colaborador</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Concepto</TableHead>
                <TableHead>Novedad Siigo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-20 text-center text-sm text-muted-foreground">
                    Sin bonos en el periodo con los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((b) => (
                  <Fragment key={b.id}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap">{b.fecha}</TableCell>
                      <TableCell>
                        <div className="font-medium">{b.nombre}</div>
                        <div className="text-xs text-muted-foreground">CC {b.identificacion}</div>
                      </TableCell>
                      <TableCell>{b.tipo}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <span className="line-clamp-2 text-xs">{b.concepto}</span>
                      </TableCell>
                      <TableCell className="text-xs">{b.novedadSiigo}</TableCell>
                      <TableCell className="text-right font-medium">{money(b.valor)}</TableCell>
                      <TableCell>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${ESTADO_CLASS[b.estado]}`}>
                          {b.estado}
                        </span>
                        {b.estado !== "pendiente" && b.aprobadoPor && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">por {b.aprobadoPor}</div>
                        )}
                        {b.motivoRechazo && (
                          <div className="mt-0.5 text-[10px] text-destructive">{b.motivoRechazo}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {b.estado === "pendiente" ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 gap-1"
                              disabled={updatingId === b.id || !claveOk}
                              title={claveOk ? "Aprobar el bono" : "Ingresa la clave de aprobación para habilitar"}
                              onClick={() => accion(b.id, () => aprobarBono(b.id, clave), "Bono aprobado")}
                            >
                              {claveOk ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />} Aprobar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1"
                              disabled={updatingId === b.id}
                              onClick={() => setRechazando(rechazando === b.id ? null : b.id)}
                            >
                              <X className="h-3 w-3" /> Rechazar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              disabled={updatingId === b.id}
                              title="Eliminar"
                              onClick={() => accion(b.id, () => eliminarBono(b.id), "Bono eliminado")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {rechazando === b.id && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={8} className="px-3 py-2">
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[280px] flex-1 space-y-1">
                              <Label className="text-xs">Motivo del rechazo</Label>
                              <Input
                                value={motivo}
                                onChange={(e) => setMotivo(e.target.value)}
                                placeholder="Por qué se rechaza este bono…"
                                className="h-8"
                              />
                            </div>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={updatingId === b.id || !motivo.trim()}
                              onClick={() => accion(b.id, () => rechazarBono(b.id, motivo), "Bono rechazado")}
                            >
                              Confirmar rechazo
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setRechazando(null); setMotivo("") }}>
                              Cancelar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
          <p className="mt-2 text-xs text-muted-foreground">
            Solo los bonos <strong>aprobados</strong> entran a la nómina (columna "Bonif. no prestacional") y salen en
            el archivo plano con su novedad. Un bono aprobado ya no se puede eliminar: si fue un error, recházalo.
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 py-6 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <div className="font-medium text-destructive">No se pudieron cargar los bonos</div>
              <div className="mt-1 text-muted-foreground">{error}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div
          className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "text-amber-600 dark:text-amber-400" : ""}`}
        >
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}
