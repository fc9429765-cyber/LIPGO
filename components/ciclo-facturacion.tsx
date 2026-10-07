"use client"

// CICLO DE FACTURACIÓN (Gestión Financiera › Facturación).
//
// Flujo documental de una prefactura ya aprobada: anexo enviado (Jefe de
// Facturación) -> anexo firmado por el cliente (Coordinador) -> factura
// enviada (Jefe) -> factura firmada por el cliente (Coordinador) -> cierre
// (Jefe). Desde el cierre arranca cartera/cobro (días vencidos, pagos). Ver
// lib/ciclo-facturacion-actions.ts.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { getUserPermissions } from "@/lib/permissions-actions"
import BotonFacturarSiigo from "@/components/facturacion/boton-facturar-siigo"
import { Checkbox } from "@/components/ui/checkbox"
import { emitirFacturaOrden, emitirFacturaPrefactura, getConfigEmision } from "@/lib/siigo-emision-actions"
import { CORTE_CICLO_SIIGO } from "@/lib/ciclo-facturacion-shared"
import { getValoresNetosOrden } from "@/lib/facturacion-control-actions"
import {
  listarCicloFacturacion,
  getEventosCiclo,
  solicitarCorreccion,
  marcarCierre,
  registrarPago,
  getPagosDe,
  getCondicionesPagoOwner,
  actualizarCondicionPagoOwner,
  getCondicionesEnvioAnexo,
  actualizarCondicionEnvioAnexo,
  getCondicionesGeneracionPrefactura,
  actualizarCondicionGeneracionPrefactura,
  generarPrefacturaAhora,
  previsualizarPendienteGestion,
  type PendienteGestionOwner,
  getSoporteDePrefactura,
  type PrefacturaCiclo,
  type EventoCiclo,
  type EstadoCiclo,
  type EtapaDocumento,
  type EtapaCorregible,
  type PagoPrefactura,
  type CondicionEnvioAnexo,
  type CondicionGeneracionPrefactura,
} from "@/lib/ciclo-facturacion-actions"
import { Switch } from "@/components/ui/switch"
import { DIAS_SEMANA_LABEL } from "@/lib/ciclo-facturacion-shared"
import { getAccessibleEmpresesFromPermisos } from "@/lib/orders-actions"
import { AdjuntosUploader } from "@/components/ciclo-facturacion/adjuntos-uploader"
import { SoporteAnexo } from "@/components/cuadro-control-facturacion"
import type { SoporteLinea } from "@/lib/facturacion-control-actions"
import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, FileClock, Inbox, Loader2, Receipt, RefreshCw, Settings2, Wallet, X } from "lucide-react"

const money = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`

const PASOS: { key: EstadoCiclo; label: string; evento: EtapaDocumento | null; rol: "jefe" | "coordinador" }[] = [
  { key: "pendiente_anexo", label: "Anexo enviado", evento: "anexo_enviado", rol: "jefe" },
  { key: "pendiente_firma_anexo", label: "Anexo firmado", evento: "anexo_firmado", rol: "coordinador" },
  { key: "pendiente_factura", label: "Factura enviada", evento: "factura_enviada", rol: "jefe" },
  { key: "pendiente_firma_factura", label: "Factura firmada", evento: "factura_firmada", rol: "coordinador" },
  { key: "pendiente_cierre", label: "Cierre", evento: null, rol: "jefe" },
]
const IDX_ESTADO: Record<EstadoCiclo, number> = {
  pendiente_anexo: 0,
  pendiente_firma_anexo: 1,
  pendiente_factura: 2,
  pendiente_firma_factura: 3,
  pendiente_cierre: 4,
  cerrado: 5,
}

const LABEL_EVENTO: Record<string, string> = {
  anexo_enviado: "Anexo enviado",
  anexo_firmado: "Anexo firmado por el cliente",
  factura_enviada: "Factura enviada",
  factura_firmada: "Factura firmada por el cliente",
  cierre: "Cierre de facturación",
  correccion_solicitada: "Corrección solicitada",
}

/** Línea de pasos con círculos + conector, coloreada por estado (hecho/actual/futuro). */
function Stepper({ estado }: { estado: EstadoCiclo }) {
  const idx = estado === "cerrado" ? PASOS.length : IDX_ESTADO[estado]
  return (
    <div className="flex items-center">
      {PASOS.map((p, i) => {
        const hecho = i < idx
        const actual = i === idx
        return (
          <div key={p.key} className="flex items-center">
            {i > 0 && (
              <div
                className={`h-0.5 w-4 sm:w-6 ${i <= idx ? "bg-emerald-500" : "bg-border"}`}
                aria-hidden="true"
              />
            )}
            <div className="flex flex-col items-center gap-0.5" title={p.label}>
              <div
                className={
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-2 " +
                  (hecho
                    ? "bg-emerald-500 text-white ring-emerald-500 dark:bg-emerald-600 dark:ring-emerald-600"
                    : actual
                      ? "animate-pulse bg-amber-500 text-white ring-amber-500 dark:bg-amber-600 dark:ring-amber-600"
                      : "bg-muted text-muted-foreground ring-border")
                }
              >
                {hecho ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span
                className={
                  "hidden text-[9px] leading-none sm:block " +
                  (hecho
                    ? "font-medium text-emerald-700 dark:text-emerald-400"
                    : actual
                      ? "font-bold text-amber-700 dark:text-amber-400"
                      : "text-muted-foreground")
                }
              >
                {p.label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BadgeCobro({ estado, dias }: { estado: "pendiente" | "parcial" | "pagada" | null; dias: number | null }) {
  if (!estado) return null
  if (estado === "pagada")
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300">Pagada</Badge>
  const vencida = dias !== null && dias > 0
  if (vencida) return <Badge variant="destructive">Vencida {dias}d</Badge>
  if (estado === "parcial")
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-300">Parcial</Badge>
  return <Badge variant="secondary">Pendiente{dias !== null && dias < 0 ? ` (vence en ${-dias}d)` : ""}</Badge>
}

export default function CicloFacturacion() {
  const { toast } = useToast()
  const { user } = useAuth() as any
  const usuario: string = user?.email || user?.nombre || "usuario"

  const [permisos, setPermisos] = useState<{ jefe: boolean; coordinador: boolean }>({ jefe: false, coordinador: false })
  useEffect(() => {
    getUserPermissions()
      .then((p) => setPermisos({ jefe: !!p?.ciclo_facturacion_jefe, coordinador: !!p?.ciclo_facturacion_coordinador }))
      .catch(() => setPermisos({ jefe: false, coordinador: false }))
  }, [])

  const [data, setData] = useState<PrefacturaCiclo[]>([])
  const [loading, setLoading] = useState(true)
  // Prefacturas marcadas para facturar en Siigo (solo las de anexo firmado).
  const [selPref, setSelPref] = useState<number[]>([])

  // Proyecto por ID + período -- aplica EN VIVO apenas cambia cualquier campo
  // (antes era un patrón pending/aplicado calcado de Cuadro de Control,
  // requería apretar "Cargar histórico" para que la fecha tuviera efecto --
  // el usuario reportó 2026-09-11 que esto confundía: escribía una fecha y
  // seguía viendo el filtro anterior porque nunca apretaba ese botón).
  const [empresas, setEmpresas] = useState<Array<{ id: number; nombre: string }>>([])
  useEffect(() => {
    getAccessibleEmpresesFromPermisos()
      .then(setEmpresas)
      .catch(() => setEmpresas([]))
  }, [])

  interface FiltrosCiclo {
    empresaId: number | null
    periodoDesde: string
    periodoHasta: string
  }
  const FILTROS_VACIOS: FiltrosCiclo = { empresaId: null, periodoDesde: "", periodoHasta: "" }
  const [filtros, setFiltros] = useState<FiltrosCiclo>(FILTROS_VACIOS)

  const [filtroEstadoCiclo, setFiltroEstadoCiclo] = useState<string>("")
  const [filtroEstadoCobro, setFiltroEstadoCobro] = useState<string>("")

  // Bandeja: separa "todas" de la vista propia de cada rol -- lo que pedía
  // el negocio ("que al coordinador le llegue lo que envía el jefe y
  // viceversa", en vez de una sola tabla revuelta con un checkbox). Arranca
  // en la bandeja del único rol que tenga la persona; si tiene los dos (o
  // ninguno) arranca en "Todas".
  //
  // "Todas" (ver los pasos del OTRO rol) queda visible para cualquiera con
  // acceso al módulo -- confirmado por el usuario 2026-09-11: "si no puede
  // tocar está bien" -- lo que de verdad no puede pasar es que alguien
  // MODIFIQUE el paso del otro rol, y eso ya lo bloquea `necesitaMiAccion`
  // más abajo (los botones de acción solo aparecen para quien tiene el
  // permiso de ESE paso), sin importar qué pestaña esté mirando.
  type Vista = "todas" | "jefe" | "coordinador" | "cartera" | "contado"
  const [vista, setVista] = useState<Vista>("todas")
  useEffect(() => {
    if (permisos.jefe && !permisos.coordinador) setVista("jefe")
    else if (permisos.coordinador && !permisos.jefe) setVista("coordinador")
  }, [permisos.jefe, permisos.coordinador])

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await listarCicloFacturacion({
      idempresa: filtros.empresaId,
      periodo_desde: filtros.periodoDesde || null,
      periodo_hasta: filtros.periodoHasta || null,
    })
    if (r.success) setData(r.data)
    else toast({ title: "Error", description: r.message, variant: "destructive" })
    setLoading(false)
  }, [filtros, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const verMesActual = () => {
    const hoy = new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    const desde = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-01`
    const hasta = `${hoy.getFullYear()}-${p(hoy.getMonth() + 1)}-${p(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate())}`
    setFiltros((f) => ({ ...f, periodoDesde: desde, periodoHasta: hasta }))
  }
  const verTodoElHistorico = () => {
    setFiltros((f) => ({ ...f, periodoDesde: "", periodoHasta: "" }))
  }

  const limpiarFiltros = () => {
    setFiltroEstadoCiclo("")
    setFiltroEstadoCobro("")
    setFiltros(FILTROS_VACIOS)
  }
  const hayFiltrosExtra = !!(filtros.empresaId || filtros.periodoDesde || filtros.periodoHasta || filtroEstadoCiclo || filtroEstadoCobro)

  // Contadores por bandeja -- sobre TODA la data (sin los filtros extra),
  // para que el número en cada pestaña sea estable mientras se filtra dentro
  // de ella.
  const contadores = useMemo(() => {
    const enProceso = data.filter((d) => d.estado_ciclo !== "cerrado")
    return {
      todas: data.length,
      jefe: enProceso.filter((d) => PASOS[IDX_ESTADO[d.estado_ciclo]]?.rol === "jefe").length,
      coordinador: enProceso.filter((d) => PASOS[IDX_ESTADO[d.estado_ciclo]]?.rol === "coordinador").length,
      cartera: data.filter((d) => d.estado_ciclo === "cerrado").length,
    }
  }, [data])

  const filtrados = useMemo(() => {
    return data.filter((d) => {

      if (vista === "jefe") return d.estado_ciclo !== "cerrado" && PASOS[IDX_ESTADO[d.estado_ciclo]]?.rol === "jefe"
      if (vista === "coordinador") return d.estado_ciclo !== "cerrado" && PASOS[IDX_ESTADO[d.estado_ciclo]]?.rol === "coordinador"
      if (vista === "cartera") {
        if (d.estado_ciclo !== "cerrado") return false
        if (filtroEstadoCobro && d.estado_cobro !== filtroEstadoCobro) return false
        return true
      }
      // "todas"
      if (filtroEstadoCiclo && d.estado_ciclo !== filtroEstadoCiclo) return false
      if (filtroEstadoCobro && d.estado_ciclo === "cerrado" && d.estado_cobro !== filtroEstadoCobro) return false
      return true
    })
  }, [data, filtroEstadoCiclo, filtroEstadoCobro, vista])

  const [seleccionId, setSeleccionId] = useState<number | null>(null)

  const resumen = useMemo(() => {
    const enCiclo = data.filter((d) => d.estado_ciclo !== "cerrado").length
    const cerradas = data.filter((d) => d.estado_ciclo === "cerrado")
    const carteraPendiente = cerradas.reduce((s, d) => s + (d.estado_cobro !== "pagada" ? d.saldo : 0), 0)
    const vencidas = cerradas.filter((d) => d.diasVencida !== null && d.diasVencida > 0 && d.estado_cobro !== "pagada")
    const carteraVencida = vencidas.reduce((s, d) => s + d.saldo, 0)
    return { enCiclo, cerradas: cerradas.length, carteraPendiente, carteraVencida, vencidasCount: vencidas.length }
  }, [data])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="rounded-full bg-amber-100 p-2 dark:bg-amber-950/40">
              <FileClock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none">{resumen.enCiclo}</div>
              <div className="text-[11px] text-muted-foreground">En proceso</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-950/40">
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none">{resumen.cerradas}</div>
              <div className="text-[11px] text-muted-foreground">Cerradas</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-950/40">
              <Wallet className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none">{money(resumen.carteraPendiente)}</div>
              <div className="text-[11px] text-muted-foreground">Cartera pendiente</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-3">
            <div className="rounded-full bg-red-100 p-2 dark:bg-red-950/40">
              <Clock className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-lg font-bold leading-none text-red-600 dark:text-red-400">{money(resumen.carteraVencida)}</div>
              <div className="text-[11px] text-muted-foreground">Vencida ({resumen.vencidasCount})</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ciclo de Facturación</CardTitle>
          <CardDescription>
            Anexo enviado → firmado por el cliente → factura enviada → firmada → cierre. Desde el cierre, cartera/cobro (días vencidos).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Bandeja por rol -- separa lo que le toca al Jefe de lo que le
              toca al Coordinador, en vez de una sola tabla con un checkbox. */}
          <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="todas" className="gap-1.5 text-xs">
                <Inbox className="h-3.5 w-3.5" /> Todas <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{contadores.todas}</Badge>
              </TabsTrigger>
              {permisos.jefe && (
                <TabsTrigger value="jefe" className="gap-1.5 text-xs">
                  Bandeja del Jefe <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{contadores.jefe}</Badge>
                </TabsTrigger>
              )}
              {permisos.coordinador && (
                <TabsTrigger value="coordinador" className="gap-1.5 text-xs">
                  Bandeja del Coordinador <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{contadores.coordinador}</Badge>
                </TabsTrigger>
              )}
              <TabsTrigger value="cartera" className="gap-1.5 text-xs">
                <Wallet className="h-3.5 w-3.5" /> Cartera <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{contadores.cartera}</Badge>
              </TabsTrigger>
              {permisos.jefe && (
                <TabsTrigger value="contado" className="gap-1.5 text-xs">
                  <Receipt className="h-3.5 w-3.5" /> Pagos de Contado
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Proyecto</Label>
                <select
                  className="h-8 w-[210px] rounded-md border border-input bg-background px-2 text-xs font-medium"
                  value={filtros.empresaId ?? ""}
                  onChange={(e) => setFiltros((f) => ({ ...f, empresaId: e.target.value ? Number(e.target.value) : null }))}
                >
                  <option value="">Todos los proyectos</option>
                  {empresas.map((em) => (
                    <option key={em.id} value={em.id}>
                      {em.nombre} (ID {em.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Período desde</Label>
                <DatePickerField value={filtros.periodoDesde} onChange={(v) => setFiltros((f) => ({ ...f, periodoDesde: v }))} className="h-8 w-[150px] text-xs" />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] text-muted-foreground">Período hasta</Label>
                <DatePickerField value={filtros.periodoHasta} onChange={(v) => setFiltros((f) => ({ ...f, periodoHasta: v }))} className="h-8 w-[150px] text-xs" />
              </div>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={verMesActual}>
                Ver mes actual
              </Button>
              {(filtros.periodoDesde || filtros.periodoHasta) && (
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={verTodoElHistorico}>
                  Ver todo el histórico
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={cargar} disabled={loading} title="Recargar sin cambiar los filtros">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Sin período seleccionado se trae todo lo accesible. El filtro aplica apenas cambias cualquier campo.
            </p>
            {(vista === "todas" || vista === "cartera" || hayFiltrosExtra) && (
              <div className="flex flex-wrap items-end gap-2 border-t pt-2">
                {vista === "todas" && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Etapa</Label>
                    <Select value={filtroEstadoCiclo || "todos"} onValueChange={(v) => setFiltroEstadoCiclo(v === "todos" ? "" : v)}>
                      <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Etapa" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todas las etapas</SelectItem>
                        {PASOS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                        <SelectItem value="cerrado">Cerrado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {(vista === "todas" || vista === "cartera") && (
                  <div className="flex flex-col gap-1">
                    <Label className="text-[10px] text-muted-foreground">Cobro</Label>
                    <Select value={filtroEstadoCobro || "todos"} onValueChange={(v) => setFiltroEstadoCobro(v === "todos" ? "" : v)}>
                      <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Cobro" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Cualquier cobro</SelectItem>
                        <SelectItem value="pendiente">Pendiente</SelectItem>
                        <SelectItem value="parcial">Parcial</SelectItem>
                        <SelectItem value="pagada">Pagada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {hayFiltrosExtra && (
                  <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={limpiarFiltros}>Limpiar todos los filtros</Button>
                )}
              </div>
            )}
          </div>

          {permisos.jefe && (vista === "todas" || vista === "jefe") && (
            <CortePorRango empresas={empresas} empresaId={filtros.empresaId} usuario={usuario} onGenerado={cargar} />
          )}

          {vista === "contado" ? (
            <PagosContadoPanel empresaId={filtros.empresaId} periodoDesde={filtros.periodoDesde} periodoHasta={filtros.periodoHasta} />
          ) : loading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Cargando…</div>
          ) : data.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <FileClock className="h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm font-medium">Todavía no hay ninguna prefactura en el ciclo</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Este panel se llena solo: apenas se aprueba una prefactura en <strong>Cuadro de Control de Facturación</strong> o{" "}
                <strong>Prefactura de Producción</strong>, aparece aquí en "Anexo enviado" para que el Jefe de Facturación empiece el ciclo.
              </p>
            </div>
          ) : filtrados.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Ninguna prefactura coincide con estos filtros.
              {hayFiltrosExtra && (
                <Button variant="link" size="sm" className="h-auto p-0 pl-1 text-xs" onClick={limpiarFiltros}>Limpiar filtros</Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {permisos.jefe && (
                <BarraFacturarPrefacturas
                  prefacturas={filtrados}
                  sel={selPref}
                  setSel={setSelPref}
                  onCambio={cargar}
                />
              )}
              {filtrados.map((p) => (
                <FilaCiclo
                  key={p.id}
                  p={p}
                  seleccionado={selPref.includes(p.id)}
                  onSeleccion={
                    permisos.jefe && prefacturaFacturable(p)
                      ? (on: boolean) => setSelPref((prev) => (on ? [...prev, p.id] : prev.filter((x) => x !== p.id)))
                      : undefined
                  }
                  abierto={seleccionId === p.id}
                  onToggle={() => setSeleccionId(seleccionId === p.id ? null : p.id)}
                  permisos={permisos}
                  usuario={usuario}
                  onCambio={cargar}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {permisos.jefe && <FrecuenciaGeneracionPrefacturaPanel />}
      {permisos.jefe && <FrecuenciaEnvioAnexoPanel />}
      {permisos.jefe && <CondicionesPagoPanel />}
    </div>
  )
}

function FilaCiclo({
  p,
  abierto,
  onToggle,
  permisos,
  usuario,
  onCambio,
  seleccionado = false,
  onSeleccion,
}: {
  p: PrefacturaCiclo
  abierto: boolean
  onToggle: () => void
  permisos: { jefe: boolean; coordinador: boolean }
  usuario: string
  onCambio: () => void
  seleccionado?: boolean
  /** Presente solo si la prefactura se puede facturar ya (anexo firmado). */
  onSeleccion?: (on: boolean) => void
}) {
  const rolPaso = p.estado_ciclo !== "cerrado" ? PASOS[IDX_ESTADO[p.estado_ciclo]]?.rol : null
  const necesitaMiAccion = (rolPaso === "jefe" && permisos.jefe) || (rolPaso === "coordinador" && permisos.coordinador)
  return (
    <div className={"rounded-md border " + (seleccionado ? "border-primary/50 bg-primary/5 " : "") + (necesitaMiAccion ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/10" : "")}>
      <div className="flex items-stretch">
      {onSeleccion && (
        <label className="flex items-center border-r px-2.5" title="Seleccionar para facturar en Siigo">
          <Checkbox checked={seleccionado} onCheckedChange={(c) => onSeleccion(!!c)} />
        </label>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {p.owner} <span className="text-xs font-normal text-muted-foreground">· {p.proyecto}</span>
            {necesitaMiAccion && (
              <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                Te toca a ti
              </span>
            )}
            {p.ownerMezclado && (
              <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" /> mezcla varios owners
              </span>
            )}
            {p.advertencias?.length > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" /> {p.advertencias.length} advertencia{p.advertencias.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {p.periodo_desde || "?"} a {p.periodo_hasta || "?"} · {money(p.total)}
            {p.ultimoEvento && ` · último: ${LABEL_EVENTO[p.ultimoEvento.evento] || p.ultimoEvento.evento} (${new Date(p.ultimoEvento.created_at).toLocaleDateString("es-CO")})`}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Stepper estado={p.estado_ciclo} />
          {p.estado_ciclo === "cerrado" && <BadgeCobro estado={p.estado_cobro} dias={p.diasVencida} />}
          {abierto ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </div>
      </button>
      </div>
      {/* El botón de facturar va FUERA del botón que expande la fila: no se
          pueden anidar, y emitir no debe compartir zona de clic con "ver el
          detalle".

          Solo con el anexo firmado (`pendiente_factura`): el ciclo es
          obligatorio. En las etapas anteriores se dice qué falta en vez de
          ofrecer un botón que el servidor va a rechazar. Al emitir, la
          prefactura pasa sola a "Factura enviada". */}
      {p.numero_factura_siigo ? (
        <div className="flex items-center justify-end gap-1.5 border-t px-3 py-1.5 text-[10px] text-emerald-700">
          <Check className="h-3 w-3" /> Facturada en Siigo · {p.numero_factura_siigo}
        </div>
      ) : p.estado_ciclo === "pendiente_factura" ? (
        <div className="flex items-center justify-end gap-2 border-t px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">Anexo firmado por el cliente · lista para facturar</span>
          <BotonFacturarSiigo
            prefacturaId={p.id}
            orden={`${p.owner || p.proyecto || "Prefactura"} · ${p.periodo_desde || "?"} a ${p.periodo_hasta || "?"}`}
            cliente={p.owner || null}
            valor={p.total}
            onEmitida={onCambio}
          />
        </div>
      ) : IDX_ESTADO[p.estado_ciclo] < IDX_ESTADO.pendiente_factura ? (
        <div className="flex items-center justify-end border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          Para facturar en Siigo falta: {p.estado_ciclo === "pendiente_anexo" ? "enviar el anexo y que el cliente lo firme" : "que el cliente firme el anexo"}
        </div>
      ) : null}
      {abierto && <DetalleCiclo prefactura={p} permisos={permisos} usuario={usuario} onCambio={onCambio} />}
    </div>
  )
}

/** ¿Se puede facturar ya en Siigo? Mismas reglas que puedeFacturarPrefactura. */
function prefacturaFacturable(p: PrefacturaCiclo): boolean {
  return p.estado_ciclo === "pendiente_factura" && !p.numero_factura_siigo && Number(p.total) > 0
}

/**
 * CORTE POR RANGO DE FECHAS
 *
 * El período del ciclo deja de depender solo de la cadencia automática: el
 * Jefe elige desde/hasta y se genera la prefactura (una por owner) de ese
 * tramo, que entra al ciclo en "Anexo enviado". Antes esto existía escondido
 * como "rango manual (excepción)" dentro del panel de automatización, uno por
 * proyecto; aquí es la forma normal de cortar.
 *
 * Sin proyecto elegido corta TODOS los proyectos del selector. Si el "desde"
 * no empata con el período anterior, la prefactura sale igual pero con
 * advertencia (regla de generarPrefacturaAhora).
 */
function CortePorRango({
  empresas,
  empresaId,
  usuario,
  onGenerado,
}: {
  empresas: Array<{ id: number; nombre: string }>
  empresaId: number | null
  usuario: string
  onGenerado: () => void
}) {
  const { toast } = useToast()
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const piso = (d: string) => (d && d > CORTE_CICLO_SIIGO ? d : CORTE_CICLO_SIIGO)
  const [desde, setDesde] = useState(piso(`${hoy.slice(0, 7)}-01`))
  const [hasta, setHasta] = useState(hoy)
  const [generando, setGenerando] = useState(false)

  const objetivo = empresaId ? empresas.filter((e) => e.id === empresaId) : empresas

  const generar = async () => {
    if (!desde || !hasta || desde > hasta) {
      toast({ title: "Rango inválido", description: "Revisa las fechas: 'desde' no puede ser posterior a 'hasta'.", variant: "destructive" })
      return
    }
    const nombres = objetivo.map((e) => e.nombre).join(", ")
    if (!confirm(`¿Generar el corte ${desde} a ${hasta} para ${objetivo.length === 1 ? nombres : `${objetivo.length} proyectos (${nombres})`}?\n\nSe crea una prefactura por cada owner con actividad en el rango, y entra al ciclo en "Anexo enviado".`)) return
    setGenerando(true)
    const lineas: string[] = []
    let generadas = 0
    for (const e of objetivo) {
      const r = await generarPrefacturaAhora(e.id, usuario, { desde, hasta })
      for (const ro of r.resultados) {
        if (ro.estado === "generada") generadas++
        lineas.push(`${e.nombre} · ${ro.owner}: ${ro.estado}`)
      }
      if (!r.resultados.length && !r.success) lineas.push(`${e.nombre}: ${r.mensaje}`)
    }
    setGenerando(false)
    toast({
      title: generadas ? `${generadas} prefactura(s) generada(s)` : "Nada que generar en ese rango",
      description: lineas.slice(0, 8).join("\n") || undefined,
    })
    onGenerado()
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5">
      <div className="mr-1">
        <p className="text-xs font-semibold">Corte por rango de fechas</p>
        <p className="text-[10px] text-muted-foreground">
          {empresaId ? objetivo[0]?.nombre ?? "Proyecto" : "Todos los proyectos"} · una prefactura por owner
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Desde</Label>
        <DatePickerField value={desde} onChange={(v) => setDesde(piso(v))} className="h-8 w-[140px] text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Hasta</Label>
        <DatePickerField value={hasta} onChange={setHasta} className="h-8 w-[140px] text-xs" />
      </div>
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={generar} disabled={generando || objetivo.length === 0}>
        {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileClock className="h-3.5 w-3.5" />}
        Generar corte
      </Button>
    </div>
  )
}

/**
 * Selección múltiple de prefacturas con el anexo firmado y facturación en
 * lote: una factura por prefactura (cada una ya es la agrupación de un owner
 * y un período). En serie y sin parar al primer error; al final se dice
 * cuáles fallaron y por qué.
 */
function BarraFacturarPrefacturas({
  prefacturas,
  sel,
  setSel,
  onCambio,
}: {
  prefacturas: PrefacturaCiclo[]
  sel: number[]
  setSel: (f: (prev: number[]) => number[]) => void
  onCambio: () => void
}) {
  const { toast } = useToast()
  const [lote, setLote] = useState<{ hechas: number; total: number } | null>(null)
  const listas = useMemo(() => prefacturas.filter(prefacturaFacturable), [prefacturas])
  // Si cambian los filtros, la selección se queda solo con lo visible.
  useEffect(() => {
    setSel((prev) => prev.filter((id) => listas.some((p) => p.id === id)))
  }, [listas, setSel])
  const elegidas = listas.filter((p) => sel.includes(p.id))
  const total = elegidas.reduce((s, p) => s + Number(p.total || 0), 0)
  if (listas.length === 0) return null

  const facturar = async () => {
    const cfg = await getConfigEmision()
    const oficial = cfg.data?.enviarDian === true
    if (
      !confirm(
        `Vas a emitir ${elegidas.length} factura(s) en Siigo, una por prefactura, por ${money(total)} en total.\n\n` +
          (oficial ? "Saldrán FIRMADAS Y OFICIALES ante la DIAN. No se pueden borrar: solo anular con nota crédito.\n\n" : "Quedarán como borrador en Siigo.\n\n") +
          "Cada una pasa a «Factura enviada» en el ciclo. ¿Continuar?",
      )
    )
      return
    const fallas: string[] = []
    let ok = 0
    setLote({ hechas: 0, total: elegidas.length })
    for (let i = 0; i < elegidas.length; i++) {
      const p = elegidas[i]
      const r = await emitirFacturaPrefactura(p.id)
      if (r.success) ok++
      else fallas.push(`${p.owner} (${p.periodo_desde} a ${p.periodo_hasta}): ${r.message ?? "error"}`)
      setLote({ hechas: i + 1, total: elegidas.length })
    }
    setLote(null)
    setSel(() => [])
    toast({
      title: `${ok} de ${elegidas.length} facturas emitidas`,
      description: fallas.length ? `Fallaron: ${fallas.slice(0, 3).join(" · ")}${fallas.length > 3 ? " …" : ""}` : undefined,
      variant: fallas.length ? "destructive" : undefined,
    })
    onCambio()
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={elegidas.length > 0 && elegidas.length === listas.length}
          disabled={!!lote}
          onCheckedChange={(c) => setSel(() => (c ? listas.map((p) => p.id) : []))}
        />
        {listas.length} lista(s) para facturar (anexo firmado)
      </label>
      {elegidas.length > 0 && (
        <span className="text-xs text-muted-foreground">
          · <strong className="text-foreground">{elegidas.length}</strong> seleccionada(s) · <strong className="text-foreground tabular-nums">{money(total)}</strong>
        </span>
      )}
      <Button size="sm" className="ml-auto h-7 gap-1.5 text-xs" onClick={facturar} disabled={!elegidas.length || !!lote}>
        {lote ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {lote.hechas}/{lote.total}
          </>
        ) : (
          <>Facturar seleccionadas en Siigo</>
        )}
      </Button>
    </div>
  )
}

function DetalleCiclo({
  prefactura,
  permisos,
  usuario,
  onCambio,
}: {
  prefactura: PrefacturaCiclo
  permisos: { jefe: boolean; coordinador: boolean }
  usuario: string
  onCambio: () => void
}) {
  const { toast } = useToast()
  const [eventos, setEventos] = useState<EventoCiclo[]>([])
  const [pagos, setPagos] = useState<PagoPrefactura[]>([])
  const [soporte, setSoporte] = useState<SoporteLinea[] | null>(null)
  const [mostrarAnexo, setMostrarAnexo] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [correccionAbierta, setCorreccionAbierta] = useState(false)
  const [pagoAbierto, setPagoAbierto] = useState(false)
  const [archivoAVer, setArchivoAVer] = useState<{ url: string; nombre: string } | null>(null)

  const recargarDetalle = useCallback(async () => {
    const [ev, pg] = await Promise.all([
      getEventosCiclo(prefactura.id),
      prefactura.estado_ciclo === "cerrado" ? getPagosDe(prefactura.id) : Promise.resolve({ success: true, data: [] as PagoPrefactura[] }),
    ])
    if (ev.success) setEventos(ev.data)
    if (pg.success) setPagos(pg.data)
  }, [prefactura.id, prefactura.estado_ciclo])

  useEffect(() => {
    recargarDetalle()
  }, [recargarDetalle])

  const cargarSoporte = async () => {
    if (soporte) {
      setMostrarAnexo((v) => !v)
      return
    }
    const r = await getSoporteDePrefactura(prefactura.id)
    if (r.success) {
      setSoporte(r.data)
      setMostrarAnexo(true)
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const idx = IDX_ESTADO[prefactura.estado_ciclo]
  const pasoActual = PASOS[idx] // undefined si ya está en pendiente_cierre->cerrado via marcarCierre
  const rolActual = pasoActual?.rol
  const puedoActuar = rolActual === "jefe" ? permisos.jefe : rolActual === "coordinador" ? permisos.coordinador : false

  // Último documento recibido (el archivo del paso anterior -- por eso el
  // que ve el paso actual puede revisarlo antes de actuar). Se busca de
  // atrás hacia adelante porque `eventos` viene ordenado ascendente.
  const ultimoDocumento = [...eventos].reverse().find((e) => e.archivo_url)
  const esAutomatico = (u: string) => u.toLowerCase().includes("sistema")

  const cerrar = async () => {
    setCerrando(true)
    const r = await marcarCierre(prefactura.id, usuario)
    setCerrando(false)
    if (r.success) {
      toast({ title: "Facturación cerrada", description: "Arranca el seguimiento de cartera/cobro." })
      onCambio()
    } else toast({ title: "No se pudo cerrar", description: r.message, variant: "destructive" })
  }

  return (
    <div className="space-y-4 border-t bg-muted/20 p-3">
      {/* Advertencias de la generación automática (sin tarifa vigente, pago
          que no cuadra, avisos de producción) -- se generó igual, pero
          quedaron guardadas para que el Jefe las revise y corrija si hace
          falta. Van primero: es lo más urgente de ver al abrir la fila. */}
      {prefactura.advertencias?.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Advertencias de la generación automática -- revisar
          </div>
          <ul className="space-y-0.5 text-[11px] text-amber-800 dark:text-amber-300">
            {prefactura.advertencias.map((a, i) => (
              <li key={i}>
                <span className="font-medium">{a.tipo}:</span> {a.detalle}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Último documento recibido -- lo que mandó la otra persona (o el
          cron) para llegar al paso actual. Con badge Automático/Manual para
          que el Jefe pueda revisar lo que el cron envió solo, y el
          Coordinador vea de una el anexo/factura que le llegó a firmar. */}
      {ultimoDocumento && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-3">
          <div className="text-xs">
            <span className="font-semibold">{LABEL_EVENTO[ultimoDocumento.evento] || ultimoDocumento.evento}</span>
            {" "}
            <Badge
              variant="secondary"
              className={
                "align-middle text-[10px] " +
                (esAutomatico(ultimoDocumento.usuario)
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                  : "")
              }
            >
              {esAutomatico(ultimoDocumento.usuario) ? "Automático" : "Manual"}
            </Badge>
            <div className="text-muted-foreground">
              {new Date(ultimoDocumento.created_at).toLocaleString("es-CO")} · {ultimoDocumento.usuario}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setArchivoAVer({ url: ultimoDocumento.archivo_url!, nombre: ultimoDocumento.archivo_nombre || "documento.pdf" })}
          >
            Ver documento
          </Button>
        </div>
      )}

      {/* Acción del paso actual */}
      {prefactura.estado_ciclo !== "cerrado" && (
        <div className="rounded-md border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold">
              Paso actual: {pasoActual?.label} — le corresponde a{" "}
              <span className="uppercase">{rolActual === "jefe" ? "Jefe de Facturación" : "Coordinador"}</span>
            </div>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={cargarSoporte}>
              {mostrarAnexo ? "Ocultar anexo" : "Ver anexo original"}
            </Button>
          </div>
          {!puedoActuar ? (
            <p className="text-xs text-muted-foreground">No tienes el permiso para este paso -- solo puedes consultar.</p>
          ) : pasoActual?.evento ? (
            <AdjuntosUploader
              prefacturaId={prefactura.id}
              evento={pasoActual.evento}
              usuario={usuario}
              label={`Adjuntar ${pasoActual.label.toLowerCase()}`}
              onDone={() => {
                recargarDetalle()
                onCambio()
              }}
            />
          ) : (
            <Button size="sm" onClick={cerrar} disabled={cerrando}>
              {cerrando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Cerrar facturación
            </Button>
          )}
        </div>
      )}

      {mostrarAnexo && soporte && (
        <div className="rounded-md border bg-background p-3">
          <div className="mb-2 text-xs font-semibold">Anexo original de la prefactura</div>
          <SoporteAnexo lineas={soporte} />
        </div>
      )}

      {/* Cartera (solo si cerrado) */}
      {prefactura.estado_ciclo === "cerrado" && (
        <div className="rounded-md border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold">
              Cartera: {money(prefactura.saldo)} pendiente de {money(prefactura.total)} · vence {prefactura.fecha_vencimiento}
            </div>
            {permisos.jefe && prefactura.estado_cobro !== "pagada" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPagoAbierto(true)}>
                Registrar pago
              </Button>
            )}
          </div>
          {pagos.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {pagos.map((pg) => (
                <li key={pg.id}>
                  {pg.fecha} · {money(pg.valor)} {pg.observacion ? `· ${pg.observacion}` : ""} {pg.usuario ? `· ${pg.usuario}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Timeline */}
      <div>
        <div className="mb-1.5 text-xs font-semibold">Historial</div>
        <ul className="space-y-2 border-l-2 border-border pl-3 text-[11px]">
          {eventos.map((e) => {
            const esCorreccion = e.evento === "correccion_solicitada"
            return (
              <li key={e.id} className="relative">
                <span
                  className={
                    "absolute -left-[17px] top-0.5 h-2 w-2 rounded-full " +
                    (esCorreccion ? "bg-amber-500 dark:bg-amber-600" : "bg-emerald-500 dark:bg-emerald-600")
                  }
                />
                <span className={esCorreccion ? "font-medium text-amber-700 dark:text-amber-400" : "font-medium"}>
                  {LABEL_EVENTO[e.evento] || e.evento}
                </span>{" "}
                — {new Date(e.created_at).toLocaleString("es-CO")} · {e.usuario}
                {e.archivo_nombre && (
                  <>
                    {" · "}
                    <a href={e.archivo_url || "#"} target="_blank" rel="noreferrer" className="text-primary underline">
                      {e.archivo_nombre}
                    </a>
                  </>
                )}
                {e.nota && <div className="italic text-muted-foreground">{e.nota}</div>}
              </li>
            )
          })}
          {eventos.length === 0 && <li className="text-muted-foreground">Sin eventos todavía.</li>}
        </ul>
      </div>

      {permisos.jefe && (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-amber-700 dark:text-amber-400" onClick={() => setCorreccionAbierta(true)}>
          Solicitar corrección
        </Button>
      )}

      {correccionAbierta && (
        <ModalCorreccion
          prefacturaId={prefactura.id}
          usuario={usuario}
          onClose={() => setCorreccionAbierta(false)}
          onOk={() => {
            setCorreccionAbierta(false)
            recargarDetalle()
            onCambio()
          }}
        />
      )}
      {pagoAbierto && (
        <ModalPago
          prefacturaId={prefactura.id}
          saldo={prefactura.saldo}
          usuario={usuario}
          onClose={() => setPagoAbierto(false)}
          onOk={() => {
            setPagoAbierto(false)
            recargarDetalle()
            onCambio()
          }}
        />
      )}

      <Dialog open={!!archivoAVer} onOpenChange={(v) => !v && setArchivoAVer(null)}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{archivoAVer?.nombre}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-lg border bg-muted">
            {archivoAVer && <iframe src={archivoAVer.url} title={archivoAVer.nombre} className="h-full w-full" />}
          </div>
          <DialogFooter>
            {archivoAVer && (
              <Button variant="outline" onClick={() => window.open(archivoAVer.url, "_blank", "noopener,noreferrer")}>
                Abrir en pestaña nueva
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const ETAPAS_CORREGIBLES: { value: EtapaCorregible; label: string }[] = [
  { value: "anexo_enviado", label: "Anexo enviado" },
  { value: "anexo_firmado", label: "Anexo firmado" },
  { value: "factura_enviada", label: "Factura enviada" },
  { value: "factura_firmada", label: "Factura firmada" },
  { value: "cierre", label: "Cierre" },
]

function ModalCorreccion({
  prefacturaId,
  usuario,
  onClose,
  onOk,
}: {
  prefacturaId: number
  usuario: string
  onClose: () => void
  onOk: () => void
}) {
  const { toast } = useToast()
  const [etapa, setEtapa] = useState<EtapaCorregible>("anexo_enviado")
  const [nota, setNota] = useState("")
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (!nota.trim()) {
      toast({ title: "Falta el motivo", variant: "destructive" })
      return
    }
    setGuardando(true)
    const r = await solicitarCorreccion(prefacturaId, etapa, nota.trim(), usuario)
    setGuardando(false)
    if (r.success) {
      toast({ title: "Corrección registrada", description: "La etapa se reabrió para volver a subir el archivo correcto." })
      onOk()
    } else toast({ title: "No se pudo", description: r.message, variant: "destructive" })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Solicitar corrección</DialogTitle>
          <DialogDescription>Reabre la etapa elegida para volver a subir el archivo correcto. El historial no se borra.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Etapa a corregir</Label>
            <Select value={etapa} onValueChange={(v) => setEtapa(v as EtapaCorregible)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ETAPAS_CORREGIBLES.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Motivo (obligatorio)</Label>
            <Textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} placeholder="¿Qué estaba mal?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Confirmar corrección
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModalPago({
  prefacturaId,
  saldo,
  usuario,
  onClose,
  onOk,
}: {
  prefacturaId: number
  saldo: number
  usuario: string
  onClose: () => void
  onOk: () => void
}) {
  const { toast } = useToast()
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [valor, setValor] = useState(saldo)
  const [observacion, setObservacion] = useState("")
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    setGuardando(true)
    const r = await registrarPago(prefacturaId, { fecha, valor: Number(valor) || 0, observacion: observacion.trim() || undefined, usuario })
    setGuardando(false)
    if (r.success) {
      toast({ title: "Pago registrado" })
      onOk()
    } else toast({ title: "No se pudo", description: r.message, variant: "destructive" })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>Saldo pendiente: {money(saldo)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Fecha</Label>
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Valor</Label>
            <Input type="number" value={valor} onChange={(e) => setValor(Number(e.target.value))} />
          </div>
          <div>
            <Label className="text-xs">Observación (opcional)</Label>
            <Textarea value={observacion} onChange={(e) => setObservacion(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Próxima fecha (DD/MM) en la que el cron dispararía la generación
 * automática para esta lista de cortes -- solo una guía visual en pantalla
 * para que el Jefe vea de inmediato que quedó bien configurado, no cambia
 * ningún cálculo real (ese vive en el cron). Mismo recorte de fin de mes.
 */
function proximoCorteLabel(diasCorte: number[]): string {
  if (!diasCorte.length) return ""
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const candidatos: Date[] = []
  for (let offsetMes = 0; offsetMes <= 2; offsetMes++) {
    const y = hoy.getFullYear()
    const m = hoy.getMonth() + offsetMes
    const diasEnMes = new Date(y, m + 1, 0).getDate()
    for (const d of diasCorte) {
      const efectivo = Math.min(d, diasEnMes)
      const disparo = new Date(y, m, efectivo + 1) // dispara al día siguiente del corte
      if (disparo >= hoy) candidatos.push(disparo)
    }
  }
  if (!candidatos.length) return ""
  candidatos.sort((a, b) => a.getTime() - b.getTime())
  const prox = candidatos[0]
  const p = (n: number) => String(n).padStart(2, "0")
  return `${p(prox.getDate())}/${p(prox.getMonth() + 1)}`
}

function FrecuenciaGeneracionPrefacturaPanel() {
  const { toast } = useToast()
  const { user } = useAuth() as any
  const usuario: string = user?.email || user?.nombre || "usuario"
  const [abierto, setAbierto] = useState(true)
  const [condiciones, setCondiciones] = useState<CondicionGeneracionPrefactura[]>([])
  const [guardando, setGuardando] = useState<number | null>(null)
  const [generando, setGenerando] = useState<number | null>(null)
  const [nuevoCorte, setNuevoCorte] = useState<Record<number, string>>({})
  const [rangoManual, setRangoManual] = useState<Record<number, { desde: string; hasta: string }>>({})
  // Aviso proactivo: cuánto de cada proyecto sigue SIN validar por el
  // Coordinador (quedaría fuera del próximo corte) -- pedido explícito del
  // usuario 2026-09-14, "que sirva para gestionar" (no solo informar): el
  // aviso trae un link directo a Solicitar Facturas, ya filtrado.
  const [pendientes, setPendientes] = useState<Record<number, PendienteGestionOwner[]>>({})

  const cargarPendientes = async (lista: CondicionGeneracionPrefactura[]) => {
    const activos = lista.filter((c) => c.activo)
    const resultados = await Promise.all(activos.map((c) => previsualizarPendienteGestion(c.idempresa)))
    const mapa: Record<number, PendienteGestionOwner[]> = {}
    activos.forEach((c, i) => {
      const r = resultados[i]
      if (r.success) mapa[c.idempresa] = r.porOwner.filter((o) => o.valorSinGestionar > 0)
    })
    setPendientes(mapa)
  }

  const cargar = async () => {
    const r = await getCondicionesGeneracionPrefactura()
    if (r.success) {
      setCondiciones(r.data)
      cargarPendientes(r.data)
    }
  }
  useEffect(() => {
    if (abierto) cargar()
  }, [abierto])

  const irAGestionar = (idempresa: number) => {
    window.dispatchEvent(new CustomEvent("lipgo:ir-a-gestionar-facturas", { detail: { empresaId: idempresa, estado: "pendiente" } }))
  }

  const actualizarLocal = (idempresa: number, patch: Partial<CondicionGeneracionPrefactura>) => {
    setCondiciones((prev) => prev.map((c) => (c.idempresa === idempresa ? { ...c, ...patch } : c)))
  }

  const guardar = async (c: CondicionGeneracionPrefactura) => {
    setGuardando(c.idempresa)
    const r = await actualizarCondicionGeneracionPrefactura(c.idempresa, c.frecuencia, c.dia_semana, c.activo, c.fecha_inicio, c.dias_corte)
    setGuardando(null)
    if (r.success) toast({ title: "Guardado" })
    else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  const generarAhora = async (c: CondicionGeneracionPrefactura) => {
    if (!confirm(`¿Generar la(s) prefactura(s) pendiente(s) de ${c.proyecto} ahora mismo? Esto crea documentos reales -- uno por cada cliente (owner) con actividad pendiente (mismo efecto que si corriera el cron hoy).`)) return
    setGenerando(c.idempresa)
    const r = await generarPrefacturaAhora(c.idempresa, usuario)
    setGenerando(null)
    if (r.resultados.length === 0) {
      toast({ title: r.success ? "Nada que generar" : "No se generó", description: r.mensaje, variant: r.success ? "default" : "destructive" })
      return
    }
    const detalle = r.resultados.map((ro) => `${ro.owner}: ${ro.estado === "generada" ? "generada" : ro.estado} -- ${ro.mensaje}`).join("\n")
    toast({
      title: r.estado === "generada" ? "Prefactura(s) generada(s)" : r.estado === "parcial" ? "Generado con avisos" : "Sin novedad",
      description: detalle,
      variant: r.success ? "default" : "destructive",
    })
  }

  const generarRangoManual = async (c: CondicionGeneracionPrefactura) => {
    const rango = rangoManual[c.idempresa]
    if (!rango?.desde || !rango?.hasta) return
    if (
      !confirm(
        `¿Generar la(s) prefactura(s) de ${c.proyecto} para el rango ${rango.desde} a ${rango.hasta}? Esto crea documentos reales -- uno por cada cliente (owner) con actividad en ese rango. Si ese "desde" no coincide con el período contiguo esperado, la prefactura se genera igual pero queda con una advertencia visible para que la revises.`,
      )
    )
      return
    setGenerando(c.idempresa)
    const r = await generarPrefacturaAhora(c.idempresa, usuario, rango)
    setGenerando(null)
    if (r.resultados.length === 0) {
      toast({ title: r.success ? "Nada que generar" : "No se generó", description: r.mensaje, variant: r.success ? "default" : "destructive" })
      return
    }
    const detalle = r.resultados.map((ro) => `${ro.owner}: ${ro.estado === "generada" ? "generada" : ro.estado} -- ${ro.mensaje}`).join("\n")
    toast({
      title: r.estado === "generada" ? "Prefactura(s) generada(s)" : r.estado === "parcial" ? "Generado con avisos" : "Sin novedad",
      description: detalle,
      variant: r.success ? "default" : "destructive",
    })
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-2" onClick={() => setAbierto((v) => !v)}>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Automatización: generación de prefacturas por Proyecto</span>
          <span className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={(e) => {
                e.stopPropagation()
                cargar()
              }}
              title="Recargar condiciones y avisos de gestión pendiente"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Actualizar
            </Button>
            {abierto ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </span>
        </CardTitle>
        <CardDescription className="text-xs">
          Sin activar, la prefactura la sigue generando una persona a mano en Cuadro de Control / Prefactura de Producción -- ese sigue siendo el default.
          Al activarla, el cron genera solo el período siguiente (desde el día después de la última prefactura aprobada, hasta ayer) todos los días a las
          8am, y si encuentra advertencias (sin tarifa vigente, pago que no cuadra) igual la genera y te avisa aquí para que la revises después. Si el
          proyecto NUNCA ha tenido una prefactura, no hay de dónde partir -- escribe la "Fecha de inicio" una sola vez para que arranque; de ahí en
          adelante sigue solo. <strong>Usa "Generar ahora" para probarlo o para no esperar al cron de mañana</strong> -- hace exactamente lo mismo que
          la corrida automática, pero al instante y con el resultado a la vista. En proyectos no diarios, el cuadro punteado <strong>"Rango manual
          (excepción)"</strong> permite generar un tramo puntual con fechas exactas en vez del período contiguo automático -- para cierres
          anticipados u otros casos fuera de lo normal. <strong>Las órdenes de Cargue/Descargue/Distribución solo entran en el anexo cuando el
          Coordinador ya las validó en Solicitar Facturas</strong> ("CF - Factura solicitada", con el tiquete de báscula o la foto de la orden) --
          la Tolva/producción no necesita ese paso. Si algo sigue sin validar, aparece abajo con un link directo para ir a gestionarlo.
        </CardDescription>
      </CardHeader>
      {abierto && (
        <CardContent className="space-y-3">
          {condiciones.map((c) => (
            <div key={c.idempresa} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <label className="flex w-40 items-center gap-2 text-xs">
                <Switch checked={c.activo} onCheckedChange={(v) => actualizarLocal(c.idempresa, { activo: v })} />
                {c.proyecto}
              </label>
              <Select
                value={c.frecuencia}
                onValueChange={(v) =>
                  actualizarLocal(c.idempresa, {
                    frecuencia: v as "diario" | "semanal" | "cortes",
                    dia_semana: v === "semanal" ? (c.dia_semana ?? 1) : c.dia_semana,
                  })
                }
                disabled={!c.activo}
              >
                <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="diario">Diario</SelectItem>
                  <SelectItem value="cortes">Cortes del mes</SelectItem>
                </SelectContent>
              </Select>
              {c.frecuencia === "semanal" && (
                <Select value={String(c.dia_semana ?? 1)} onValueChange={(v) => actualizarLocal(c.idempresa, { dia_semana: Number(v) })} disabled={!c.activo}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIAS_SEMANA_LABEL.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-1.5">
                <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Fecha de inicio (si nunca ha facturado)</Label>
                <DatePickerField
                  value={c.fecha_inicio || ""}
                  onChange={(v) => actualizarLocal(c.idempresa, { fecha_inicio: v || null })}
                  className="h-7 w-36 text-xs"
                  disabled={!c.activo}
                />
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => guardar(c)} disabled={guardando === c.idempresa}>
                {guardando === c.idempresa && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Guardar
              </Button>
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => generarAhora(c)}
                disabled={generando === c.idempresa}
                title="Genera ya mismo la prefactura pendiente de este proyecto, sin esperar al cron de mañana"
              >
                {generando === c.idempresa && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Generar ahora
              </Button>

              {c.frecuencia !== "diario" && (
                <div className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Rango manual (excepción)</Label>
                  <DatePickerField
                    value={rangoManual[c.idempresa]?.desde || ""}
                    onChange={(v) => setRangoManual((prev) => ({ ...prev, [c.idempresa]: { desde: v || "", hasta: prev[c.idempresa]?.hasta || "" } }))}
                    className="h-7 w-32 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">a</span>
                  <DatePickerField
                    value={rangoManual[c.idempresa]?.hasta || ""}
                    onChange={(v) => setRangoManual((prev) => ({ ...prev, [c.idempresa]: { desde: prev[c.idempresa]?.desde || "", hasta: v || "" } }))}
                    className="h-7 w-32 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => generarRangoManual(c)}
                    disabled={generando === c.idempresa || !rangoManual[c.idempresa]?.desde || !rangoManual[c.idempresa]?.hasta}
                    title="Genera exactamente este rango de fechas, en vez del período contiguo automático -- para casos puntuales"
                  >
                    {generando === c.idempresa && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                    Generar rango
                  </Button>
                </div>
              )}

              {c.frecuencia === "cortes" && (
                <div className="w-full space-y-1.5 pl-1 pt-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {c.dias_corte.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">Sin días de corte todavía.</span>
                    )}
                    {c.dias_corte.map((d) => (
                      <Badge key={d} variant="secondary" className="gap-1 text-[11px]">
                        Día {d}
                        <button
                          type="button"
                          className="rounded-full hover:bg-muted-foreground/20"
                          onClick={() => actualizarLocal(c.idempresa, { dias_corte: c.dias_corte.filter((x) => x !== d) })}
                          disabled={!c.activo}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      placeholder="Día (1-31)"
                      value={nuevoCorte[c.idempresa] ?? ""}
                      onChange={(e) => setNuevoCorte((prev) => ({ ...prev, [c.idempresa]: e.target.value }))}
                      className="h-7 w-24 text-xs"
                      disabled={!c.activo}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={!c.activo}
                      onClick={() => {
                        const n = Number(nuevoCorte[c.idempresa])
                        if (!Number.isInteger(n) || n < 1 || n > 31) return
                        if (!c.dias_corte.includes(n)) {
                          actualizarLocal(c.idempresa, { dias_corte: [...c.dias_corte, n].sort((a, b) => a - b) })
                        }
                        setNuevoCorte((prev) => ({ ...prev, [c.idempresa]: "" }))
                      }}
                    >
                      Agregar corte
                    </Button>
                    {c.dias_corte.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        Próximo corte automático: <strong>{proximoCorteLabel(c.dias_corte)}</strong>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Cada corte es el ÚLTIMO día incluido en su período -- el siguiente arranca solo al día siguiente, sin pisarse.
                    Un corte en 31 también cubre fin de mes en los meses más cortos. Se repite todos los meses sin que tengas que
                    volver a configurarlo.
                  </p>
                </div>
              )}

              {(pendientes[c.idempresa]?.length ?? 0) > 0 && (
                <div className="w-full rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  {pendientes[c.idempresa]!.map((o) => `${o.owner}: ${money(o.valorSinGestionar)} en ${o.ordenes} orden(es)`).join(" · ")}{" "}
                  sin validar por el Coordinador -- quedarían fuera del próximo corte si se genera ahora.{" "}
                  <button type="button" className="font-semibold underline hover:no-underline" onClick={() => irAGestionar(c.idempresa)}>
                    Ir a gestionarlas
                  </button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

function FrecuenciaEnvioAnexoPanel() {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(true)
  const [condiciones, setCondiciones] = useState<CondicionEnvioAnexo[]>([])
  const [guardando, setGuardando] = useState<number | null>(null)

  const cargar = async () => {
    const r = await getCondicionesEnvioAnexo()
    if (r.success) setCondiciones(r.data)
  }
  useEffect(() => {
    if (abierto) cargar()
  }, [abierto])

  const actualizarLocal = (idempresa: number, patch: Partial<CondicionEnvioAnexo>) => {
    setCondiciones((prev) => prev.map((c) => (c.idempresa === idempresa ? { ...c, ...patch } : c)))
  }

  const guardar = async (c: CondicionEnvioAnexo) => {
    setGuardando(c.idempresa)
    const r = await actualizarCondicionEnvioAnexo(c.idempresa, c.frecuencia, c.dia_semana)
    setGuardando(null)
    if (r.success) toast({ title: "Guardado" })
    else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-2" onClick={() => setAbierto((v) => !v)}>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Clock className="h-4 w-4" /> Automatización: envío de anexos por Proyecto</span>
          {abierto ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </CardTitle>
        <CardDescription className="text-xs">
          Cada proyecto puede tener su propio ritmo de facturación -- el cron corre a diario, pero solo envía el anexo de un proyecto cuando le toca según esta configuración.
        </CardDescription>
      </CardHeader>
      {abierto && (
        <CardContent className="space-y-2">
          {condiciones.map((c) => (
            <div key={c.idempresa} className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-xs">{c.proyecto}</span>
              <Select value={c.frecuencia} onValueChange={(v) => actualizarLocal(c.idempresa, { frecuencia: v as "diario" | "semanal", dia_semana: v === "semanal" ? (c.dia_semana ?? 1) : c.dia_semana })}>
                <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="diario">Diario</SelectItem>
                </SelectContent>
              </Select>
              {c.frecuencia === "semanal" && (
                <Select value={String(c.dia_semana ?? 1)} onValueChange={(v) => actualizarLocal(c.idempresa, { dia_semana: Number(v) })}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIAS_SEMANA_LABEL.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => guardar(c)} disabled={guardando === c.idempresa}>
                {guardando === c.idempresa && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Guardar
              </Button>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

function CondicionesPagoPanel() {
  const { toast } = useToast()
  const [abierto, setAbierto] = useState(true)
  const [condiciones, setCondiciones] = useState<{ owner: string; dias_plazo: number }[]>([])
  const [editando, setEditando] = useState<Record<string, number>>({})

  const cargar = async () => {
    const r = await getCondicionesPagoOwner()
    if (r.success) setCondiciones(r.data)
  }
  useEffect(() => {
    if (abierto) cargar()
  }, [abierto])

  const guardar = async (owner: string) => {
    const dias = editando[owner]
    if (!(dias > 0)) return
    const r = await actualizarCondicionPagoOwner(owner, dias)
    if (r.success) {
      toast({ title: "Guardado" })
      cargar()
    } else toast({ title: "Error", description: r.message, variant: "destructive" })
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-2" onClick={() => setAbierto((v) => !v)}>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" /> Condición de pago por Owner</span>
          {abierto ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </CardTitle>
      </CardHeader>
      {abierto && (
        <CardContent className="space-y-2">
          {condiciones.length === 0 && <p className="text-xs text-muted-foreground">Todavía no hay owners con condición de pago propia -- se crean automáticamente al cerrar la primera factura de cada uno (default 30 días).</p>}
          {condiciones.map((c) => (
            <div key={c.owner} className="flex items-center gap-2">
              <span className="w-48 text-xs">{c.owner}</span>
              <Input
                type="number"
                className="h-7 w-24 text-xs"
                defaultValue={c.dias_plazo}
                onChange={(e) => setEditando((prev) => ({ ...prev, [c.owner]: Number(e.target.value) }))}
              />
              <span className="text-xs text-muted-foreground">días</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => guardar(c.owner)}>Guardar</Button>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pagos de Contado -- pestaña de RECONCILIACIÓN BANCARIA (2026-09-14, pedido
// del usuario). Las órdenes de pago de contado (mediopago="Contado") se
// gestionan hoy en Solicitar Facturas -- el Coordinador sube ahí la FOTO del
// comprobante (`cabeceraoc.comprobante`), pero antes de esto no existía
// ninguna pantalla que agrupara esos comprobantes para cruzarlos contra el
// extracto bancario: quedaban enterrados en cada orden, uno por uno. Esta
// pestaña NO agrega ningún dato nuevo, solo hace consultable/filtrable lo que
// ya se captura (misma fuente que Solicitar Facturas: `/api/gestion-facturas`,
// filtrado por `medioPago=Contado`, reusa el Proyecto/Período de la barra de
// arriba del módulo).
// ---------------------------------------------------------------------------

interface OrdenContado {
  id: number
  ordendecargue: string
  fechacargue: string
  placa: string
  transporte: string
  cliente: string | null
  valorpago: number | null
  cuentatransferencia: string | null
  comprobante: string | null
  estadofactura: string | null
  /** La API ya lo devolvía; faltaba declararlo para poder saber si ya se facturó. */
  facturasiigo?: string | null
  /** Para calcular el neto: la tarifa depende de la empresa de cada orden. */
  idempresa?: number | null
}

function comprobanteUrls(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [raw]
  } catch {
    return [raw]
  }
}

function esComprobantePdf(url: string): boolean {
  const limpio = url.split("?")[0].split("#")[0]
  return limpio.toLowerCase().endsWith(".pdf")
}

function PagosContadoPanel({
  empresaId,
  periodoDesde,
  periodoHasta,
}: {
  empresaId: number | null
  periodoDesde: string
  periodoHasta: string
}) {
  const { toast } = useToast()
  const [ordenes, setOrdenes] = useState<OrdenContado[]>([])
  const [loading, setLoading] = useState(true)
  const [soloSinComprobante, setSoloSinComprobante] = useState(false)
  const [cuentaFiltro, setCuentaFiltro] = useState("")
  const [viendoComprobante, setViendoComprobante] = useState<OrdenContado | null>(null)
  const [indiceImagen, setIndiceImagen] = useState(0)
  /*
   * Fuerza recargar la lista tras emitir una factura: la orden pasa a tener
   * `facturasiigo` y debe dejar de ofrecer el botón.
   *
   * Es un contador y no sacar `cargar` del efecto porque aquel maneja
   * cancelación con una bandera local; extraerlo obligaría a rehacer esa parte
   * para ganar lo mismo.
   */
  const [recarga, setRecarga] = useState(0)
  /*
   * Valor NETO por orden -- operación x tarifa, el mismo cálculo del cuadro y
   * de la prefactura.
   *
   * `valorpago` SOLO se llena cuando alguien confirma la factura en Solicitar
   * Facturas, asi que antes de eso llega en cero y la pantalla mostraba $0 en
   * todo. Solicitar Facturas ya resolvia esto calculando el neto aparte; aqui
   * faltaba, y sin el no se puede facturar sin pasar antes por alla.
   */
  const [valoresNetos, setValoresNetos] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelado = false
    const cargar = async () => {
      setLoading(true)
      try {
        // Sin tope: pagina hasta agotar TODO el historial que matchee el
        // filtro -- un solo pageSize=500 recortaba en silencio proyectos con
        // más de 500 pagos de contado acumulados, justo lo que este tab
        // necesita para poder cruzar contra el banco (usuario 2026-09-14).
        const acumulado: OrdenContado[] = []
        let page = 1
        for (;;) {
          const params = new URLSearchParams({ medioPago: "Contado", pageSize: "500", page: String(page) })
          if (empresaId) params.set("empresaId", String(empresaId))
          /*
           * El corte manda sobre el filtro de la pantalla.
           *
           * Se arranca de cero el 1 de octubre para emitir en Siigo desde este
           * mes: lo anterior ya se facturó por fuera, y mostrarlo aquí
           * invitaría a volver a facturarlo. Si alguien pide una fecha
           * anterior, se usa la del corte.
           */
          const desde =
            periodoDesde && periodoDesde > CORTE_CICLO_SIIGO ? periodoDesde : CORTE_CICLO_SIIGO
          params.set("fechaCargueDesde", desde)
          if (periodoHasta) params.set("fechaCargueHasta", periodoHasta)
          const res = await fetch(`/api/gestion-facturas?${params.toString()}`)
          const json = await res.json()
          if (cancelado) return
          if (!json.success) {
            toast({ title: "Error", description: json.error, variant: "destructive" })
            break
          }
          acumulado.push(...json.data)
          const totalPages = json.pagination?.totalPages || 1
          if (page >= totalPages) break
          page++
        }
        if (!cancelado) setOrdenes(acumulado)
      } catch (e: any) {
        if (!cancelado) toast({ title: "Error", description: e?.message || "No se pudo cargar", variant: "destructive" })
      }
      if (!cancelado) setLoading(false)
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [empresaId, periodoDesde, periodoHasta, toast, recarga])

  /*
   * El valor neto se pide DESPUES de tener las ordenes, igual que en Solicitar
   * Facturas: solo el de las ordenes ya cargadas, no el del historial entero.
   *
   * Se calcula POR EMPRESA DE CADA ORDEN, no por el filtro del modulo: la
   * tarifa depende de la empresa, y el filtro arranca en "Todos los
   * proyectos". Con el filtro vacio antes no se calculaba nada y toda la
   * pestaña salia en $0 (reportado 2026-10-07).
   */
  useEffect(() => {
    if (ordenes.length === 0) {
      setValoresNetos({})
      return
    }
    let cancelado = false
    const porEmpresa = new Map<number, string[]>()
    for (const o of ordenes) {
      const e = Number(o.idempresa ?? empresaId ?? 0)
      if (!e || !o.ordendecargue) continue
      porEmpresa.set(e, [...(porEmpresa.get(e) ?? []), o.ordendecargue])
    }
    Promise.all(Array.from(porEmpresa.entries()).map(([e, nums]) => getValoresNetosOrden(e, nums)))
      .then((rs) => {
        if (cancelado) return
        const m: Record<string, number> = {}
        for (const r of rs) if (r.success) Object.assign(m, r.data)
        setValoresNetos(m)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [empresaId, ordenes])

  /*
   * Lo que se muestra y lo que se factura.
   *
   * Se prefiere `valorpago` cuando existe --es el valor ya confirmado, con IVA
   * y retefuente aplicados-- y se cae al neto calculado cuando todavia no se
   * ha confirmado la factura. Al reves se pisaria un valor acordado con una
   * estimacion.
   */
  const valorDe = (o: OrdenContado) => {
    const pagado = Number(o.valorpago || 0)
    if (pagado > 0) return pagado
    return Number(valoresNetos[o.ordendecargue] || 0)
  }

  const cuentas = useMemo(
    () => Array.from(new Set(ordenes.map((o) => o.cuentatransferencia).filter(Boolean))) as string[],
    [ordenes],
  )

  const filtradas = useMemo(
    () =>
      ordenes.filter((o) => {
        if (soloSinComprobante && o.comprobante) return false
        if (cuentaFiltro && o.cuentatransferencia !== cuentaFiltro) return false
        return true
      }),
    [ordenes, soloSinComprobante, cuentaFiltro],
  )

  const total = filtradas.reduce((s, o) => s + valorDe(o), 0)
  const sinComprobante = filtradas.filter((o) => !o.comprobante).length

  /*
   * Selección para facturar en lote. Solo se marcan las que el servidor va a
   * aceptar: solicitadas en Solicitar Facturas, sin factura y con valor.
   */
  const [sel, setSel] = useState<number[]>([])
  const [lote, setLote] = useState<{ hechas: number; total: number } | null>(null)
  const facturableContado = (o: OrdenContado) =>
    String(o.estadofactura ?? "").trim() === "CF - Factura solicitada" && !String(o.facturasiigo ?? "").trim() && valorDe(o) > 0
  const listas = filtradas.filter(facturableContado)
  useEffect(() => {
    setSel((prev) => prev.filter((id) => listas.some((o) => o.id === id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtradas, valoresNetos])
  const elegidas = listas.filter((o) => sel.includes(o.id))
  const totalSel = elegidas.reduce((s, o) => s + valorDe(o), 0)
  // "Juntas" solo si todas son del mismo cliente: facturarle a uno lo que pagó otro es el error más caro.
  const clientesSel = Array.from(new Set(elegidas.map((o) => String(o.cliente ?? "").trim())))

  const facturarUnaPorUna = async () => {
    const cfg = await getConfigEmision()
    const oficial = cfg.data?.enviarDian === true
    if (
      !confirm(
        `Vas a emitir ${elegidas.length} factura(s) en Siigo, una por orden, por ${money(totalSel)} en total.\n\n` +
          (oficial ? "Saldrán FIRMADAS Y OFICIALES ante la DIAN. No se pueden borrar: solo anular con nota crédito.\n\n" : "Quedarán como borrador en Siigo.\n\n") +
          "¿Continuar?",
      )
    )
      return
    const fallas: string[] = []
    let ok = 0
    setLote({ hechas: 0, total: elegidas.length })
    for (let i = 0; i < elegidas.length; i++) {
      const o = elegidas[i]
      const r = await emitirFacturaOrden(o.id)
      if (r.success) ok++
      else fallas.push(`${o.ordendecargue}: ${r.message ?? "error"}`)
      setLote({ hechas: i + 1, total: elegidas.length })
    }
    setLote(null)
    setSel([])
    toast({
      title: `${ok} de ${elegidas.length} facturas emitidas`,
      description: fallas.length ? `Fallaron: ${fallas.slice(0, 4).join(" · ")}${fallas.length > 4 ? " …" : ""}` : undefined,
      variant: fallas.length ? "destructive" : undefined,
    })
    setRecarga((n) => n + 1)
  }
  const urls = viendoComprobante ? comprobanteUrls(viendoComprobante.comprobante) : []

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Órdenes marcadas como pago de <strong>Contado</strong> en Solicitar Facturas, con el comprobante que subió el
        Coordinador -- para cruzar contra el extracto bancario. Usa el filtro de Proyecto/Período de arriba de esta pantalla.
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-2.5">
        <label className="flex items-center gap-1.5 text-xs">
          <Switch checked={soloSinComprobante} onCheckedChange={setSoloSinComprobante} /> Solo sin comprobante
        </label>
        {cuentas.length > 0 && (
          <Select value={cuentaFiltro || "todas"} onValueChange={(v) => setCuentaFiltro(v === "todas" ? "" : v)}>
            <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Cuenta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las cuentas</SelectItem>
              {cuentas.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span>{filtradas.length} orden(es)</span>
          {sinComprobante > 0 && (
            <Badge variant="destructive" className="text-[10px]">{sinComprobante} sin comprobante</Badge>
          )}
          <span className="font-semibold">{money(total)}</span>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Cargando…</div>
      ) : filtradas.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">No hay pagos de contado en este rango.</div>
      ) : (
        <div className="space-y-2">
        {listas.length > 0 && (
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
            <span className="text-xs">
              {listas.length} lista(s) para facturar
              {elegidas.length > 0 && (
                <>
                  {" "}· <strong>{elegidas.length}</strong> seleccionada(s) · <strong className="tabular-nums">{money(totalSel)}</strong>
                </>
              )}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {elegidas.length > 1 &&
                (clientesSel.length === 1 && clientesSel[0] ? (
                  <BotonFacturarSiigo
                    ordenIds={elegidas.map((o) => o.id)}
                    orden={`${clientesSel[0]} · ${elegidas.length} órdenes de contado`}
                    cliente={clientesSel[0]}
                    valor={totalSel}
                    onEmitida={() => {
                      setSel([])
                      setRecarga((n) => n + 1)
                    }}
                  />
                ) : (
                  <span className="text-[10px] text-muted-foreground">{clientesSel.length} clientes distintos: no se juntan en un documento</span>
                ))}
              <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={facturarUnaPorUna} disabled={!elegidas.length || !!lote}>
                {lote ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {lote.hechas}/{lote.total}
                  </>
                ) : (
                  <>Facturar una por una{elegidas.length ? ` (${elegidas.length})` : ""}</>
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="w-8 p-2">
                  <Checkbox
                    checked={listas.length > 0 && elegidas.length === listas.length}
                    disabled={!listas.length || !!lote}
                    onCheckedChange={(c) => setSel(c ? listas.map((o) => o.id) : [])}
                  />
                </th>
                <th className="p-2 text-left">Fecha</th>
                <th className="p-2 text-left">Orden</th>
                <th className="p-2 text-left">Placa</th>
                <th className="p-2 text-left">Cliente</th>
                <th className="p-2 text-left">Cuenta</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2 text-center">Comprobante</th>
                <th className="p-2 text-left">Estado</th>
                <th className="p-2 text-center">Siigo</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((o) => (
                <tr key={o.id} className={`border-t ${sel.includes(o.id) ? "bg-primary/5" : ""}`}>
                  <td className="p-2 text-center">
                    <Checkbox
                      checked={sel.includes(o.id)}
                      disabled={!facturableContado(o) || !!lote}
                      title={facturableContado(o) ? undefined : "Solo se factura lo solicitado en Solicitar Facturas, sin factura y con valor"}
                      onCheckedChange={(c) => setSel((prev) => (c ? [...prev, o.id] : prev.filter((x) => x !== o.id)))}
                    />
                  </td>
                  <td className="p-2">{o.fechacargue}</td>
                  <td className="p-2">{o.ordendecargue}</td>
                  <td className="p-2">{o.placa}</td>
                  <td className="p-2">{o.cliente || "-"}</td>
                  <td className="p-2">{o.cuentatransferencia || "-"}</td>
                  <td className="p-2 text-right">{money(valorDe(o))}</td>
                  <td className="p-2 text-center">
                    {o.comprobante ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          setViendoComprobante(o)
                          setIndiceImagen(0)
                        }}
                      >
                        Ver
                      </Button>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">Falta</Badge>
                    )}
                  </td>
                  <td className="p-2">{o.estadofactura || "-"}</td>
                  <td className="p-2 text-center">
                    <BotonFacturarSiigo
                      ordenId={o.id}
                      orden={o.ordendecargue}
                      cliente={o.cliente}
                      valor={valorDe(o)}
                      facturaExistente={o.facturasiigo}
                      onEmitida={() => setRecarga((n) => n + 1)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <Dialog open={!!viendoComprobante} onOpenChange={(v) => !v && setViendoComprobante(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Comprobante -- Orden {viendoComprobante?.ordendecargue}</DialogTitle>
          </DialogHeader>
          {urls.length > 0 && (
            <div className="space-y-2">
              {esComprobantePdf(urls[indiceImagen]) ? (
                <a href={urls[indiceImagen]} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline">
                  Abrir PDF en una pestaña nueva
                </a>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[indiceImagen]} alt="Comprobante" className="max-h-[60vh] w-full rounded object-contain" />
              )}
              {urls.length > 1 && (
                <div className="flex items-center justify-center gap-2">
                  <Button size="sm" variant="outline" disabled={indiceImagen === 0} onClick={() => setIndiceImagen((i) => i - 1)}>
                    Anterior
                  </Button>
                  <span className="text-xs">{indiceImagen + 1} de {urls.length}</span>
                  <Button size="sm" variant="outline" disabled={indiceImagen === urls.length - 1} onClick={() => setIndiceImagen((i) => i + 1)}>
                    Siguiente
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
