"use client"

// Centro de Coordinación (Operación LIP): pantalla única del coordinador que
// une Picking (Cargue), Packing (Descargue/Distribución) y el control de
// muelles/SLA/ritmo en una sola vista. Reutiliza las MISMAS acciones que ya
// usan esas pantallas (asignar personal, iniciar, cerrar con fotos, pausar) —
// no las reescribe. Diseño validado con el usuario en varias rondas de
// iteración: semáforo de 3 colores (verde=libre/amarillo=ocupado/rojo=fuera
// de tiempo), franja de control siempre visible (toneladas, ritmo,
// proyección), línea de 5 pasos con responsable (🚜 Montacarguista vs
// Coordinador), acciones de utilidad (pausar/reasignar/liberar), alerta
// temprana antes de vencer SLA, comparación vs. ayer, filtro "Solo
// atención", sugerencias (reforzar con auxiliar / siguiente turno) y "Parte
// de turno".

import { useCallback, useEffect, useMemo, useState } from "react"
import { setVisibleInterval } from "@/lib/polling"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Esqueleto } from "@/components/ui/lipgo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LayoutGrid, Loader2, Camera, UserPlus, Play, Pause, ChevronDown, Truck, Users, AlertTriangle, ClipboardList, CheckSquare, HandHelping } from "lucide-react"
import { ApoyoCargueDialog, type OrdenParaApoyo } from "@/components/apoyo-cargue-dialog"

/** Hoy en Colombia (YYYY-MM-DD). El Centro de Coordinación siempre trabaja
 *  sobre el día en curso, así que el personal de apoyo se busca entre quienes
 *  están presentes HOY. */
function hoyColombia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
}
import {
  getCentroCoordinacion,
  iniciarOrdenEnMuelle,
  asignarOrdenAMuelle,
  liberarMuelle,
  getHojaDelMuelle,
  getParteDeTurno,
  type CentroCoordinacionData,
  type OrdenOperativa,
  type TipoOperacion,
  type HojaMuelle,
  type ParteDeTurno,
} from "@/lib/centro-coordinacion-actions"
import {
  getCarguDescarguePersonnel,
  assignPersonnelToOrder,
  pausarOrden,
  reanudarOrden,
  type PersonnelEmployee,
} from "@/lib/picking-actions"
import { PickingPhotoUploadDialog } from "@/components/picking-photo-upload-dialog"
import { TipoPagoSelector } from "@/components/tipo-pago-selector"
import { ModoCargaSelector } from "@/components/modo-carga-selector"

const t1 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 1 })
const t2 = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 2 })

const TIPO_LABEL: Record<TipoOperacion, string> = {
  Cargue: "Cargue · Picking",
  Descargue: "Descargue · Packing",
  Distribucion: "Distribución",
}

const FILTROS: Array<{ value: TipoOperacion | "Todos"; label: string }> = [
  { value: "Todos", label: "Todos" },
  { value: "Cargue", label: "Cargue (Picking)" },
  { value: "Descargue", label: "Descargue (Packing)" },
  { value: "Distribucion", label: "Distribución" },
]

const VEHICULOS_GRANDES = new Set(["Dobletroque", "Tractomula", "Mula"])
function iconoVehiculo(tipovehiculo: string | null): string {
  if (tipovehiculo && VEHICULOS_GRANDES.has(tipovehiculo)) return "🚛"
  return "🚚"
}

function fmtHora(hhmm: string | null): string {
  return hhmm ? hhmm.slice(0, 5) : "—"
}

/** % de avance de la orden. En orden de preferencia (el más real primero):
 *  1) Cerrada: peso real de báscula contra la capacidad del vehículo.
 *  2) Cargue en curso: líneas de picking verificadas (dato real por línea).
 *  3) Cualquier orden en curso sin dato por línea (Descargue/Distribución, o
 *     Cargue antes de tener líneas): estimado por tiempo — minutos
 *     transcurridos ÷ SLA acordado × toneladas objetivo. No es un peso real,
 *     pero da una referencia razonable de "debería llevar esto" con datos
 *     que sí existen (pesoorden, iniciocargue, SLA), en vez de mostrar 0. */
/**
 * Minutos entre dos horas del mismo día ("HH:MM[:SS]"). null si falta alguna o
 * si el resultado no tiene sentido como espera —negativo, o más de 10 horas—:
 * son horas SIN fecha, así que una orden creada anoche y despachada hoy daría
 * una resta que no significa nada.
 */
function minutosEntre(desde: string | null | undefined, hasta: string | null | undefined): number | null {
  const aMin = (t: string | null | undefined) => {
    const m = String(t ?? "").match(/^(\d{1,2}):(\d{2})/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const a = aMin(desde)
  const b = aMin(hasta)
  if (a === null || b === null) return null
  const d = b - a
  return d >= 0 && d < 600 ? d : null
}

/** Duración en minutos -> "1 h 20 min" o "45 min". */
function fmtDuracion(min: number): string {
  const h = Math.floor(min / 60)
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`
}

function progresoOrden(o: OrdenOperativa): { pct: number; fuente: string } {
  if (o.fincargue && o.pesovascula != null && o.capacidadVehiculo) {
    return { pct: Math.min(100, Math.round((o.pesovascula / o.capacidadVehiculo) * 100)), fuente: "capacidad del vehículo" }
  }
  if (o.tipooperacion === "Cargue" && o.lineasTotal > 0 && o.lineasAprobadas != null) {
    return { pct: Math.round((o.lineasAprobadas / o.lineasTotal) * 100), fuente: "líneas verificadas" }
  }
  if (o.iniciocargue && o.minutosTranscurridos != null && o.slaMin) {
    const pct = Math.min(100, Math.round((o.minutosTranscurridos / o.slaMin) * 100))
    return { pct, fuente: "estimado por tiempo vs. SLA" }
  }
  return { pct: 0, fuente: "sin iniciar" }
}

function finProyectado(o: OrdenOperativa): string | null {
  if (!o.iniciocargue || o.slaMin == null) return null
  const [ih, im] = o.iniciocargue.split(":").map(Number)
  const totalMin = ih * 60 + (im || 0) + o.slaMin
  const h = Math.floor(totalMin / 60) % 24
  const m = totalMin % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

type Paso = { label: string; done: boolean; current: boolean; role: "coord" | "op"; detail?: string }

// Distribución sin facturar (no se factura entrega, no hay tonelaje que
// repartir) o Descargue de Huevos en ID2 (ese personal se paga aparte,
// puesto "Cargue/Descargue Huevos"): ninguna de las dos exige auxiliares ni
// tipo de pago para poder concluirse. Confirmado 2026-08-28. Vive a nivel de
// módulo (no dentro del componente) para que construirPasos() también la
// use: sin esto, el paso "Asignar Personal" quedaba marcado pendiente y el
// botón "Cargar fotos" ni se mostraba, aunque el cierre ya estuviera
// permitido por el otro lado. Alcance estricto: SOLO afecta órdenes con
// o.esDescargueHuevos = true (Descargue + Huevos + ID2) o Distribución sin
// facturar — el resto de órdenes sigue exigiendo personal igual que siempre.
function puedeConcluirSinPersonal(o: OrdenOperativa): boolean {
  return (o.tipooperacion === "Distribucion" && o.facturar === false) || o.esDescargueHuevos
}

function construirPasos(o: OrdenOperativa): Paso[] {
  const esCargue = o.tipooperacion === "Cargue"
  const pickingListo = esCargue ? o.lineasTotal > 0 && o.lineasAprobadas === o.lineasTotal : !!o.iniciocargue
  const pdfListo = !!o.iniciocargue
  const personalListo = o.auxiliares.length > 0 || puedeConcluirSinPersonal(o)

  const pasos: Omit<Paso, "current">[] = [{ label: "Muelle asignado", done: true, role: "coord" }]
  if (esCargue) {
    pasos.push({
      label: "Realizar Picking",
      done: pickingListo,
      role: "op",
      detail: o.lineasTotal > 0 ? `${o.lineasAprobadas ?? 0}/${o.lineasTotal}` : undefined,
    })
    pasos.push({ label: "Generar PDF", done: pdfListo, role: "op", detail: pdfListo ? fmtHora(o.iniciocargue) : undefined })
  } else {
    pasos.push({ label: "Realizar Packing + PDF", done: pdfListo, role: "op", detail: pdfListo ? fmtHora(o.iniciocargue) : undefined })
  }
  pasos.push({ label: "Asignar Personal", done: personalListo, role: "coord" })
  pasos.push({ label: "Cargar fotos", done: false, role: "coord" })

  const idxActual = pasos.findIndex((p) => !p.done)
  return pasos.map((p, i) => ({ ...p, current: i === idxActual }))
}

interface CentroCoordinacionProps {
  onNavigate?: (moduleName: string) => void
}

export default function CentroCoordinacion({ onNavigate }: CentroCoordinacionProps) {
  const { toast } = useToast()
  const { selectedEmpresaId, selectedEmpresaNombre, profile } = useAuth()

  const [data, setData] = useState<CentroCoordinacionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState<TipoOperacion | "Todos">("Todos")
  const [soloAtencion, setSoloAtencion] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [hojasPorOrden, setHojasPorOrden] = useState<Map<number, HojaMuelle>>(new Map())
  const [loadingHojaId, setLoadingHojaId] = useState<number | null>(null)

  // Asignar orden de la cola a un muelle libre / reasignar una activa.
  const [asignarDialogOrder, setAsignarDialogOrder] = useState<OrdenOperativa | null>(null)
  const [muelleElegido, setMuelleElegido] = useState<string>("")
  const [asignando, setAsignando] = useState(false)
  // Desglose de la espera por lotes, orden por orden. Se abre al tocar la
  // tarjeta: el promedio dice que hay un problema, pero no CUAL orden lo tiene.
  const [verEsperaLotes, setVerEsperaLotes] = useState(false)

  // Personal de APOYO: la misma función del módulo "Asignación de apoyo en
  // cargue", pero directo sobre la orden del muelle que se está mirando, sin
  // tener que salir a buscarla en una lista del día.
  const [ordenApoyo, setOrdenApoyo] = useState<OrdenParaApoyo | null>(null)

  // Asignar personal (mismo flujo que Picking/Packing).
  const [personnelDialogOrder, setPersonnelDialogOrder] = useState<OrdenOperativa | null>(null)
  const [personnel, setPersonnel] = useState<PersonnelEmployee[]>([])
  const [selectedPersonnel, setSelectedPersonnel] = useState<string[]>([])
  const [auxiliaresInput, setAuxiliaresInput] = useState("")
  const [loadingPersonnel, setLoadingPersonnel] = useState(false)
  const [assigningPersonnel, setAssigningPersonnel] = useState(false)

  // Cerrar con fotos (diálogo compartido con Picking).
  const [photoOrder, setPhotoOrder] = useState<OrdenOperativa | null>(null)
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false)

  const [pausingOrder, setPausingOrder] = useState<string | null>(null)

  // Parte de turno — carga bajo demanda, solo cuando se abre. Control manual
  // (no <details>/<summary>): más predecible que depender del toggle nativo.
  const [parteTurnoAbierto, setParteTurnoAbierto] = useState(false)
  const [parteTurno, setParteTurno] = useState<ParteDeTurno | null>(null)
  const [loadingParte, setLoadingParte] = useState(false)

  // El filtro de tipo NUNCA se manda al backend: los muelles son un recurso
  // físico compartido por los 3 tipos, así que siempre se piden completos.
  // El filtro solo atenúa visualmente en el cliente — ver `coincideFiltro`.
  const cargar = useCallback(async () => {
    if (!selectedEmpresaId) return
    const r = await getCentroCoordinacion(selectedEmpresaId)
    setLoading(false)
    if (r.success && r.data) {
      setData(r.data)
      for (const a of r.data.autoAsignaciones) {
        toast({
          title: "Muelle asignado automáticamente",
          description: `${a.ordendecargue} (${a.placa || "sin placa"}) llevaba 15+ min cargando sin muelle — se asignó solo al muelle ${a.muelle}.`,
        })
      }
    } else {
      toast({ title: "No se pudo cargar el Centro de Coordinación", description: r.message, variant: "destructive" })
    }
  }, [selectedEmpresaId, toast])

  useEffect(() => {
    setLoading(true)
    cargar()
    // 9 consultas por refresco: no tiene sentido seguir pegándole a la base de
    // datos cada minuto mientras la pestaña está en segundo plano.
    return setVisibleInterval(cargar, 60_000)
  }, [cargar])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const horaActualReloj = useMemo(
    () =>
      new Intl.DateTimeFormat("es-CO", {
        timeZone: "America/Bogota",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now),
    [now],
  )

  const toggleExpand = async (orden: OrdenOperativa) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(orden.orderId)) next.delete(orden.orderId)
      else next.add(orden.orderId)
      return next
    })
    if (!hojasPorOrden.has(orden.orderId)) {
      setLoadingHojaId(orden.orderId)
      const r = await getHojaDelMuelle(orden.orderId)
      setLoadingHojaId(null)
      if (r.success && r.data) {
        setHojasPorOrden((prev) => new Map(prev).set(orden.orderId, r.data!))
      }
    }
  }

  const muellesLibres = useMemo(() => (data ? data.muelles.filter((m) => !m.orden).map((m) => m.muelle) : []), [data])

  const abrirAsignar = (orden: OrdenOperativa) => {
    setAsignarDialogOrder(orden)
    setMuelleElegido(muellesLibres[0] ? String(muellesLibres[0]) : "")
  }

  const confirmarAsignar = async () => {
    if (!asignarDialogOrder || !muelleElegido) return
    setAsignando(true)
    // Si la orden YA tiene muelle (reasignar), solo movemos el muelle; si es
    // nueva (desde la cola), además dispara Generar PDF / inicia el cargue —
    // mismas acciones que ya usan Picking/Packing.
    let success: boolean
    let message: string | undefined
    let urlGenerada: string | undefined
    if (asignarDialogOrder.muelle) {
      const res = await asignarOrdenAMuelle(asignarDialogOrder.orderId, Number(muelleElegido))
      success = res.success
      message = res.message
    } else {
      const res = await iniciarOrdenEnMuelle(asignarDialogOrder.orderId, Number(muelleElegido), {
        ordendecargue: asignarDialogOrder.ordendecargue,
        cliente: asignarDialogOrder.cliente,
        placa: asignarDialogOrder.placa || "",
        conductor: asignarDialogOrder.conductor || "",
        tipooperacion: asignarDialogOrder.tipooperacion,
      })
      success = res.success
      message = res.message
      urlGenerada = res.url
    }
    setAsignando(false)
    if (success) {
      toast({ title: "Éxito", description: message })
      setAsignarDialogOrder(null)
      await cargar()
      if (urlGenerada) window.open(urlGenerada, "_blank")
    } else {
      toast({ title: "Error", description: message, variant: "destructive" })
    }
  }

  const quitarDeMuelle = async (orden: OrdenOperativa) => {
    const r = await liberarMuelle(orden.orderId)
    if (r.success) {
      toast({ title: "Muelle liberado", description: r.message })
      await cargar()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  const abrirPersonal = async (orden: OrdenOperativa) => {
    setPersonnelDialogOrder(orden)
    setSelectedPersonnel(orden.auxiliares)
    setAuxiliaresInput("")
    setLoadingPersonnel(true)
    const r = await getCarguDescarguePersonnel(selectedEmpresaId)
    setLoadingPersonnel(false)
    if (r.success) {
      // "Personal disponible" ya excluye a quien esté asignado a CUALQUIER
      // orden activa — incluida esta misma que se está editando. Para poder
      // agregar o quitar sobre lo ya asignado, la lista del diálogo debe
      // ser: disponibles + quien ya esté en ESTA orden (aunque por eso
      // mismo no salga como "disponible" en general).
      const yaEnLista = new Set(r.data.map((p) => p.nombreempleado.trim().toUpperCase()))
      const asignadosFaltantes = orden.auxiliares
        .filter((nombre) => !yaEnLista.has(nombre.trim().toUpperCase()))
        .map((nombre, i) => ({ id: -1000 - i, nombreempleado: nombre }))
      setPersonnel(
        [...r.data, ...asignadosFaltantes].sort((a, b) => a.nombreempleado.localeCompare(b.nombreempleado, "es")),
      )
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  const togglePersonnelSelection = (name: string) => {
    setSelectedPersonnel((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const confirmarPersonal = async () => {
    if (!personnelDialogOrder) return
    // Un vehículo pausado no está cargando: su personal se puede reasignar
    // por completo a otro servicio, sin dejar a nadie "reservado" acá. La
    // exigencia de mínimo 1 solo aplica a una orden activa (no pausada).
    if (selectedPersonnel.length === 0 && !personnelDialogOrder.pausado) {
      toast({ title: "Error", description: "Debe seleccionar al menos un empleado", variant: "destructive" })
      return
    }
    setAssigningPersonnel(true)
    const currentUserName = profile?.usuario || "Usuario desconocido"
    const r = await assignPersonnelToOrder(personnelDialogOrder.orderId, selectedPersonnel, auxiliaresInput, currentUserName, {
      id: personnelDialogOrder.orderId,
      ordendecargue: personnelDialogOrder.ordendecargue,
      cliente: personnelDialogOrder.cliente,
      placa: personnelDialogOrder.placa || "",
      conductor: personnelDialogOrder.conductor || "",
    })
    setAssigningPersonnel(false)
    if (r.success) {
      toast({ title: "Éxito", description: r.message })
      setPersonnelDialogOrder(null)
      await cargar()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  /**
   * "Ir a Picking": lleva al coordinador a Picking con la orden ya abierta
   * para que verifique línea por línea (lote y cantidad) y confirme allá.
   *
   * Aquí existió hasta el 2026-10-02 un "Confirmar Picking" por excepción que
   * aprobaba las líneas tal cual quedaron asignadas, sin verificar nada. Se
   * retiró por decisión de la gerencia: en la última semana de septiembre
   * (ID3) 192 de 209 salidas se confirmaron así y el conteo del 1 de octubre
   * no cuadró (lotes cruzados y cantidades que no salieron como se registró).
   * Las líneas "por descontar" solo se aprueban desde Picking.
   */
  const irAPicking = (orden: OrdenOperativa) => {
    window.dispatchEvent(new CustomEvent("lipgo:ir-a-picking", { detail: { orderId: orden.orderId } }))
  }

  const togglePausa = async (orden: OrdenOperativa) => {
    setPausingOrder(orden.ordendecargue)
    const r = orden.pausado ? await reanudarOrden(orden.ordendecargue) : await pausarOrden(orden.ordendecargue)
    setPausingOrder(null)
    if (r.success) {
      toast({ title: orden.pausado ? "Cargue reanudado" : "Cargue pausado", description: r.message })
      await cargar()
    } else {
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
  }

  const abrirFotos = (orden: OrdenOperativa) => {
    setPhotoOrder(orden)
    setPhotoDialogOpen(true)
  }

  const toggleParteTurno = async () => {
    const abriendo = !parteTurnoAbierto
    setParteTurnoAbierto(abriendo)
    if (!abriendo || parteTurno || !selectedEmpresaId) return
    setLoadingParte(true)
    const r = await getParteDeTurno(selectedEmpresaId)
    setLoadingParte(false)
    if (r.success && r.data) setParteTurno(r.data)
    else toast({ title: "No se pudo cargar el parte de turno", description: r.message, variant: "destructive" })
  }

  if (!selectedEmpresaId) {
    return (
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-xl font-bold md:text-2xl">
          <LayoutGrid className="h-5 w-5 text-primary md:h-6 md:w-6" />
          Centro de Coordinación
        </h1>
        <p className="text-sm text-muted-foreground">Selecciona un proyecto en la parte superior para continuar.</p>
      </div>
    )
  }

  const muellesFiltrados = data
    ? data.muelles.filter((slot) => !soloAtencion || (slot.orden && (slot.orden.slaVencido || slot.orden.slaEnRiesgo || slot.orden.pausado)))
    : []

  // Conteo del DÍA (abiertas + cerradas), no de ocupación en vivo — así no
  // baja cuando una orden cierra y libera su muelle.
  const conteoDia = data?.conteoTipoHoy || { Cargue: 0, Descargue: 0, Distribucion: 0 }
  const conteoPorTipo: Record<TipoOperacion | "Todos", number> = {
    Todos: conteoDia.Cargue + conteoDia.Descargue + conteoDia.Distribucion,
    ...conteoDia,
  }

  const estadoLabel = { adelantado: "Adelantado", cerca: "Cerca", atrasado: "Atrasado", sin_datos: "Sin datos aún" }
  const estadoColor = {
    adelantado: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    cerca: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
    atrasado: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400",
    sin_datos: "bg-muted text-muted-foreground",
  }

  return (
    <div className="-m-4 space-y-0 md:-m-6">
      {/* Barra superior en UNA sola linea, tambien en celular. Antes hacia
          `flex-wrap`: con un nombre de proyecto largo el reloj se iba a un
          segundo renglon y la barra —que es sticky— se comia el doble de alto
          de una pantalla que ya es corta. Ahora lo unico que cede es el nombre
          del proyecto, que se corta con "…". El reloj nunca se parte. */}
      <div className="sticky top-0 z-20 flex items-center gap-2 bg-[#0e3b3b] px-3 py-2.5 text-white shadow md:gap-3 md:px-6 md:py-3">
        <LayoutGrid className="h-5 w-5 shrink-0 text-[#21d4c8]" />
        <span className="shrink-0 text-xs font-bold tracking-tight sm:text-sm">
          <span className="sm:hidden">Coordinación</span>
          <span className="hidden sm:inline">Centro de Coordinación</span>
        </span>
        <Badge className="ml-auto min-w-0 border-white/15 bg-white/10 text-white hover:bg-white/10">
          <span className="block truncate">
            <span className="hidden sm:inline">Proyecto: </span>
            {selectedEmpresaNombre || `ID ${selectedEmpresaId}`}
          </span>
        </Badge>
        <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-[11px] text-[#cfe9e6] sm:px-2.5 sm:text-xs">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#21d4c8]" />
          {horaActualReloj}
        </span>
      </div>

      <div className="space-y-3 p-3 md:space-y-4 md:p-6">
        {loading && !data ? (
          <div className="flex flex-col gap-4" aria-busy aria-label="Cargando Centro de Coordinación">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className={`lg-card p-4 ${i === 0 ? "col-span-2" : ""}`}>
                  <Esqueleto lineas={3} />
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
              <div className="lg-card p-5"><Esqueleto lineas={5} /></div>
            </div>
          </div>
        ) : !data ? (
          <p className="py-8 text-sm text-muted-foreground">No se pudo cargar la información.</p>
        ) : (
          <>
            {data.alertaCargandoSinMuelle.length > 0 && (
              <div className="rounded-lg border-2 border-rose-600 bg-rose-600 p-3 text-white shadow-md animate-pulse">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <AlertTriangle className="h-4 w-4" />
                  {data.alertaCargandoSinMuelle.length === 1
                    ? "1 vehículo está cargando sin muelle asignado"
                    : `${data.alertaCargandoSinMuelle.length} vehículos están cargando sin muelle asignado`}
                </div>
                <div className="mt-2 space-y-1.5">
                  {data.alertaCargandoSinMuelle.map((o) => (
                    <div key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/15 px-2.5 py-1.5 text-xs">
                      <span>
                        <span className="font-mono">{o.ordendecargue}</span> · {o.cliente} · {o.placa || "sin placa"} —{" "}
                        {o.minutosTranscurridos != null ? `${o.minutosTranscurridos} min cargando` : "recién iniciado"}
                        {o.minutosTranscurridos != null && o.minutosTranscurridos >= 15
                          ? " · se asigna solo apenas haya muelle libre"
                          : ` · se asigna solo a los 15 min si nadie la asigna antes`}
                      </span>
                      <Button size="sm" variant="secondary" className="h-6 text-xs" onClick={() => abrirAsignar(o)}>
                        Asignar ahora
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.arrumeActivo.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 flex-none" />
                  Arrume activo en muelle{data.arrumeActivo.length > 1 ? "s" : ""}{" "}
                  {data.arrumeActivo.map((o) => o.muelle ?? "?").join(", ")} — otros muelles pueden tardar más de lo normal hoy.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
              {/* Ancho completo tambien en celular (`col-span-2`): esta tarjeta
                  lleva barra de progreso y tres lineas de texto, y en media
                  pantalla de 360 px los numeros se partian. */}
              <div className="col-span-2 lg-card p-4 lg:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="lg-eyebrow">Cargado hoy</div>
                  <Badge className={estadoColor[data.kpis.estadoTurno]}>{estadoLabel[data.kpis.estadoTurno]}</Badge>
                </div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="lg-num text-2xl font-bold">{t1(data.kpis.cargadoHoyTon)}</span>
                  <span className="text-xs text-muted-foreground">/ {t1(data.kpis.metaTonDia)} t meta del día</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${data.kpis.estadoTurno === "atrasado" ? "bg-rose-500" : data.kpis.estadoTurno === "cerca" ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, (data.kpis.cargadoHoyTon / Math.max(data.kpis.metaTonDia, 0.01)) * 100)}%` }}
                  />
                </div>
                {/* Un solo renglon de pie. Antes eran dos y estiraban toda la
                    fila de tarjetas. El detalle de ayer queda en el tooltip. */}
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
                  <span>
                    esperado <b className="tabular-nums text-foreground">{t1(data.kpis.metaEsperadaAhoraTon)} t</b>
                  </span>
                  <span title={`Ayer a esta hora: ${t1(data.kpis.cargadoAyerMismaHoraTon)} t`}>
                    · vs. ayer{" "}
                    {data.kpis.vsAyerPct === null ? (
                      "—"
                    ) : (
                      <b className={`tabular-nums ${data.kpis.vsAyerPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {data.kpis.vsAyerPct >= 0 ? "▲" : "▼"} {t1(Math.abs(data.kpis.vsAyerPct))}%
                      </b>
                    )}
                  </span>
                </div>
              </div>
              <div className="lg-card p-4">
                <div className="lg-eyebrow">Ritmo real</div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="lg-num text-2xl font-bold">{t2(data.kpis.ritmoTonHora)}</span>
                  <span className="text-xs text-muted-foreground">t/h</span>
                </div>
                <div className="text-[11px] text-muted-foreground">capacidad {t2(data.kpis.capacidadTonHora)} t/h</div>
              </div>
              <div className="lg-card p-4">
                <div className="lg-eyebrow">Cumplimiento SLA</div>
                <span
                  className={`lg-num text-2xl font-bold ${
                    data.kpis.slaCumplimientoPct === null
                      ? "text-muted-foreground"
                      : data.kpis.slaCumplimientoPct >= 90
                        ? "text-emerald-600 dark:text-emerald-400"
                        : data.kpis.slaCumplimientoPct >= 70
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  {data.kpis.slaCumplimientoPct === null ? "—" : `${data.kpis.slaCumplimientoPct}%`}
                </span>
                {data.kpis.ordenesEnRiesgo > 0 && (
                  <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400">{data.kpis.ordenesEnRiesgo} vencida(s)</div>
                )}
              </div>
              <div className="lg-card p-4">
                <div className="lg-eyebrow">Personal en piso</div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="lg-num text-2xl font-bold">{data.kpis.personalEnPiso}</span>
                  <span className="text-xs text-muted-foreground">aux.</span>
                </div>
                {/* Un solo renglon, como el resto de las tarjetas: dos lineas
                    aqui estiraban toda la fila. */}
                <div className="text-[11px] text-muted-foreground">
                  {data.kpis.personalAsignado} asignados ·{" "}
                  <b className="font-medium text-primary">{data.kpis.personalDisponible} disponibles</b>
                </div>
              </div>
              {/* Espera por asignación de lotes: de que nace la orden a que le
                  asignan los lotes. Es tiempo en el que la orden ya existe pero
                  todavía no se puede alistar, y la operación lo reportó como el
                  punto donde se pierde el turno. Se muestra la PEOR espera
                  además del promedio: el promedio esconde el caso que duele. */}
              {/* La tarjeta ENTERA se tiñe según la espera, no solo el número:
                  va al lado de "Proyección de cierre", que es una tarjeta de
                  color, y un fondo neutro ahí se lee como dato secundario. El
                  punto de este indicador es que salte a la vista cuando la
                  espera se dispara. Verde <30 min · ámbar 30–59 · rojo ≥60. */}
              <button
                type="button"
                onClick={() => setVerEsperaLotes(true)}
                title="Ver el detalle orden por orden"
                className={`rounded-lg border p-3 text-left shadow-sm transition-shadow hover:shadow-md ${
                  data.kpis.esperaLotesPromedioMin === null
                    ? "border-border bg-card"
                    : data.kpis.esperaLotesPromedioMin >= 60
                      ? "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                      : data.kpis.esperaLotesPromedioMin >= 30
                        ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                        : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                }`}
              >
                <div
                  className={`lg-eyebrow ${
                    data.kpis.esperaLotesPromedioMin === null
                      ? "text-muted-foreground"
                      : data.kpis.esperaLotesPromedioMin >= 60
                        ? "text-rose-700 dark:text-rose-300"
                        : data.kpis.esperaLotesPromedioMin >= 30
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-emerald-700 dark:text-emerald-300"
                  }`}
                >
                  Espera por lotes
                </div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span
                    className={`lg-num text-2xl font-bold ${
                      data.kpis.esperaLotesPromedioMin === null
                        ? "text-muted-foreground"
                        : data.kpis.esperaLotesPromedioMin >= 60
                          ? "text-rose-700 dark:text-rose-300"
                          : data.kpis.esperaLotesPromedioMin >= 30
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-emerald-700 dark:text-emerald-300"
                    }`}
                  >
                    {data.kpis.esperaLotesPromedioMin ?? "—"}
                  </span>
                  {data.kpis.esperaLotesPromedioMin != null && (
                    <span className="text-xs text-muted-foreground">min prom.</span>
                  )}
                  {/* Las pendientes van PEGADAS al numero, no en su propio
                      renglon: es lo unico accionable hoy y asi no estira la
                      tarjeta. */}
                  {data.kpis.esperaLotesPendientes > 0 && (
                    <span
                      className="ml-auto rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                      title={`${data.kpis.esperaLotesPendientes} orden(es) de cargue sin lotes asignados`}
                    >
                      {data.kpis.esperaLotesPendientes} sin lotes
                    </span>
                  )}
                </div>
                {/* Un solo renglon de apoyo: base del promedio y peor caso. El
                    numero de la orden queda en el tooltip para no partir la
                    linea en dos. */}
                <div
                  className="truncate whitespace-nowrap text-[11px] text-muted-foreground"
                  title={
                    data.kpis.esperaLotesPeor
                      ? `Peor espera de hoy: ${data.kpis.esperaLotesPeor.minutos} min — orden ${data.kpis.esperaLotesPeor.ordendecargue}`
                      : undefined
                  }
                >
                  {data.kpis.esperaLotesBaseOrdenes} órd.
                  {data.kpis.esperaLotesPeor && (
                    <>
                      {" · peor "}
                      <b className="tabular-nums text-foreground">{data.kpis.esperaLotesPeor.minutos} min</b>
                    </>
                  )}
                  <span className="ml-1 opacity-70">· toca para ver</span>
                </div>
              </button>
              <div className="rounded-lg border border-[#0e3b3b] bg-[#0e3b3b] p-3 text-white">
                <div className="lg-eyebrow text-[#8fd3ce]">Proyección de cierre</div>
                <div className="lg-num text-2xl font-bold text-[#21d4c8]">{data.kpis.proyeccionHoraFinCola || "—"}</div>
                <div className="truncate whitespace-nowrap text-[11px] text-[#cfe9e6]">
                  muelles {data.kpis.muellesOcupados}/{data.kpis.muellesTotal}
                  {data.colaSinMuelle.length > 0 && ` · ${data.colaSinMuelle.length} en cola`}
                </div>
              </div>
              <div className="lg-card p-4">
                <div className="lg-eyebrow">Tiempo de cargue</div>
                <div className="mt-0.5 flex items-baseline gap-1">
                  <span className="lg-num text-2xl font-bold">
                    {data.kpis.tiempoCargueProedioMin ?? "—"}
                  </span>
                  {data.kpis.tiempoCargueProedioMin != null && <span className="text-xs text-muted-foreground">min</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">{data.kpis.tiempoCargueBaseOrdenes} órdenes hoy</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {FILTROS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFiltroTipo(f.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        filtroTipo === f.value
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      {f.label}
                      <span
                        className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                          filtroTipo === f.value ? "bg-white/20" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {conteoPorTipo[f.value]}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => setSoloAtencion((v) => !v)}
                    className={`ml-auto rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      soloAtencion ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 text-rose-600 hover:bg-rose-50"
                    }`}
                  >
                    ⚠ Solo atención
                  </button>
                </div>

                <div className="lg-card">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2.5 md:px-4 md:py-3">
                    <h2 className="text-sm font-bold">Distribución de muelles</h2>
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">— toca un muelle para operarlo</span>
                    {/* La leyenda baja de linea en celular en vez de aplastar el titulo. */}
                    <div className="flex w-full gap-3 text-[10px] text-muted-foreground sm:ml-auto sm:w-auto">
                      <span className="flex items-center gap-1">
                        <i className="inline-block h-2 w-2 rounded-sm bg-emerald-600" />
                        Libre
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="inline-block h-2 w-2 rounded-sm bg-amber-500" />
                        Ocupado
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="inline-block h-2 w-2 rounded-sm bg-rose-600" />
                        Fuera de tiempo
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2 p-2.5">
                    {muellesFiltrados.map((slot) => (
                      <MuelleRow
                        key={slot.muelle}
                        slot={slot}
                        expanded={!!slot.orden && expandedIds.has(slot.orden.orderId)}
                        loadingHoja={!!slot.orden && loadingHojaId === slot.orden.orderId}
                        hoja={slot.orden ? hojasPorOrden.get(slot.orden.orderId) || null : null}
                        onToggle={() => slot.orden && toggleExpand(slot.orden)}
                        onAsignarPersonal={() => slot.orden && abrirPersonal(slot.orden)}
                        onAgregarApoyo={() =>
                          slot.orden &&
                          setOrdenApoyo({
                            id: slot.orden.orderId,
                            ordendecargue: slot.orden.ordendecargue,
                            auxiliares: slot.orden.auxiliares,
                          })
                        }
                        onCerrarFotos={() => slot.orden && abrirFotos(slot.orden)}
                        onPausar={() => slot.orden && togglePausa(slot.orden)}
                        onQuitar={() => slot.orden && quitarDeMuelle(slot.orden)}
                        onReasignar={() => slot.orden && abrirAsignar(slot.orden)}
                        onCambioTipoPago={cargar}
                        onCambioModoCarga={cargar}
                        onIrAPicking={() => slot.orden && irAPicking(slot.orden)}
                        pausingOrder={pausingOrder}
                        puedeConcluirSinPersonal={slot.orden ? puedeConcluirSinPersonal(slot.orden) : false}
                        metaPorHoraTrabajador={data.kpis.metaPorHoraTrabajador}
                        personalDisponibleCount={data.kpis.personalDisponible}
                        atenuado={filtroTipo !== "Todos" && !!slot.orden && slot.orden.tipooperacion !== filtroTipo}
                      />
                    ))}
                  </div>
                </div>

                {data.colaSinMuelle.length > 0 && (
                  <div className="rounded-xl border bg-card p-3 shadow-sm">
                    <h2 className="mb-2 text-sm font-bold">Cola sin muelle asignado ({data.colaSinMuelle.length})</h2>
                    <div className="space-y-1.5">
                      {data.colaSinMuelle.map((o) => (
                        <div key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm sm:flex-nowrap">
                          {/* En escritorio, una sola línea: solo cede el nombre
                              del cliente. En celular puede bajar de línea, y el
                              botón se va a su propio renglón: forzarlo todo en
                              360 px dejaba el cliente ilegible. */}
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:flex-nowrap">
                            <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{o.ordendecargue}</span>
                            <span className="min-w-0 truncate font-semibold" title={o.cliente ?? undefined}>
                              {o.cliente}
                            </span>
                            <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{o.placa}</span>
                            <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[10px]">
                              {TIPO_LABEL[o.tipooperacion]}
                            </Badge>
                            {o.rezagada && (
                              <Badge variant="outline" className="shrink-0 whitespace-nowrap border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400">
                                Pendiente de un día anterior
                              </Badge>
                            )}
                          </div>
                          <Button size="sm" variant="outline" className="h-7 w-full shrink-0 text-xs sm:w-auto" onClick={() => abrirAsignar(o)}>
                            Asignar a muelle
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border bg-card p-3 shadow-sm">
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
                    <AlertTriangle className="h-4 w-4 text-amber-600" /> Alertas de cumplimiento
                  </h2>
                  <div className="space-y-1.5">
                    {data.kpis.ordenesEnRiesgo === 0 ? (
                      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                        Todas las órdenes en cargue están dentro del SLA
                      </p>
                    ) : (
                      data.muelles
                        .filter((s) => s.orden?.slaVencido)
                        .map((s) => (
                          <div
                            key={s.orden!.orderId}
                            className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs dark:border-rose-900 dark:bg-rose-950/30"
                          >
                            Muelle {s.muelle} · <span className="font-mono">{s.orden!.ordendecargue}</span> · {s.orden!.placa} — SLA
                            vencido ({s.orden!.minutosTranscurridos} de {s.orden!.slaMin} min)
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-3 shadow-sm">
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
                    <Truck className="h-4 w-4 text-primary" /> Cola de patio ({data.colaPatio.length})
                  </h2>
                  <div className="space-y-1">
                    {data.colaPatio.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin vehículos esperando cita/orden.</p>
                    ) : (
                      data.colaPatio.map((c, i) => {
                        const sugerido = data.sugerenciaProximoTurno?.placa === c.placa
                        return (
                          <div key={i}>
                            <div
                              className={`flex items-center justify-between text-xs ${sugerido ? "-mx-2 rounded-md bg-emerald-50 px-2 py-1 dark:bg-emerald-950/30" : ""}`}
                            >
                              <span className="shrink-0 whitespace-nowrap font-mono">{c.placa}</span>
                              <span className="min-w-0 flex-1 truncate px-2 text-right text-muted-foreground" title={c.tipovehiculo || undefined}>
                                {c.tipovehiculo || "—"}
                              </span>
                              <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-muted-foreground">{fmtHora(c.horallegada)}</span>
                            </div>
                            {sugerido && (
                              <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                                💡 sugerido para Muelle {data.sugerenciaProximoTurno!.muelle} (libre ahora)
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-3 shadow-sm">
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
                    <Users className="h-4 w-4 text-primary" /> Personal disponible ({data.personalDisponibleLista.length})
                  </h2>
                  <p className="mb-1 text-[10px] text-muted-foreground">
                    Única lista de libres — se usa desde "Personal" en cualquier muelle.
                  </p>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {data.personalDisponibleLista.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nadie disponible ahora mismo.</p>
                    ) : (
                      data.personalDisponibleLista.map((p) => (
                        <div key={p.id} className="text-xs">
                          {p.nombreempleado}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="lg-card">
              <button
                type="button"
                onClick={toggleParteTurno}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold"
              >
                <ClipboardList className="h-4 w-4 text-primary" /> Parte de turno — resumen para el próximo coordinador
                <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${parteTurnoAbierto ? "rotate-180" : ""}`} />
              </button>
              {parteTurnoAbierto && (
              <div className="border-t p-4">
                {loadingParte ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Calculando...
                  </div>
                ) : !parteTurno ? (
                  <p className="text-sm text-muted-foreground">Sin datos.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5">
                      <div className="flex flex-col justify-between rounded-md border bg-background p-2">
                        <div className="text-[9px] font-semibold uppercase leading-tight text-muted-foreground">Cargado en el turno</div>
                        <div className="mt-0.5 whitespace-nowrap text-base font-bold tabular-nums">{t1(parteTurno.cargadoHoyTon)} t</div>
                      </div>
                      <div className="flex flex-col justify-between rounded-md border bg-background p-2">
                        <div className="text-[9px] font-semibold uppercase leading-tight text-muted-foreground">Órdenes cerradas</div>
                        <div className="mt-0.5 whitespace-nowrap text-base font-bold tabular-nums">{parteTurno.ordenesCerradas}</div>
                      </div>
                      <div className="flex flex-col justify-between rounded-md border bg-background p-2">
                        <div className="text-[9px] font-semibold uppercase leading-tight text-muted-foreground">En curso</div>
                        <div className="mt-0.5 whitespace-nowrap text-base font-bold tabular-nums">{parteTurno.ordenesEnCurso}</div>
                      </div>
                      <div className="flex flex-col justify-between rounded-md border bg-background p-2">
                        <div className="text-[9px] font-semibold uppercase leading-tight text-muted-foreground">SLA vencidos ahora</div>
                        <div className="mt-0.5 whitespace-nowrap text-base font-bold tabular-nums text-rose-600">{parteTurno.slaVencidosAhora}</div>
                      </div>
                      <div className="flex flex-col justify-between rounded-md border bg-background p-2">
                        <div className="text-[9px] font-semibold uppercase leading-tight text-muted-foreground">Auxiliares en piso</div>
                        <div className="mt-0.5 whitespace-nowrap text-base font-bold tabular-nums">{parteTurno.personalEnPiso}</div>
                      </div>
                    </div>
                    {parteTurno.pendientes.length > 0 && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        <strong className="text-foreground">Pendiente para el siguiente turno:</strong>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {parteTurno.pendientes.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Historial del día completo (abiertas + cerradas) con su
                        personal real asignado — esto es lo que ya no se ve en
                        el tablero de muelles apenas una orden cierra. */}
                    <div className="mt-3">
                      <h3 className="mb-1.5 text-xs font-bold text-foreground">
                        Historial de órdenes de hoy ({parteTurno.historial.length})
                      </h3>
                      <div className="max-h-72 overflow-auto rounded-md border">
                        {/* `min-w-max` + celdas `whitespace-nowrap`: la tabla
                            toma el ancho que necesita y el contenedor se
                            desplaza. Antes iba a `w-full` y, al no caber, el
                            navegador partía en dos líneas el código de orden y
                            la lista de personal. */}
                        <table className="min-w-max text-left text-xs">
                          <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                            <tr>
                              <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Orden</th>
                              <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Tipo</th>
                              <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Placa</th>
                              <th className="whitespace-nowrap px-2 py-1.5 text-center font-semibold">Muelle</th>
                              <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Estado</th>
                              <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Modo</th>
                              <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Personal real asignado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parteTurno.historial.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                                  Sin órdenes hoy.
                                </td>
                              </tr>
                            ) : (
                              parteTurno.historial.map((h) => (
                                <tr key={h.ordendecargue} className="border-t">
                                  <td className="whitespace-nowrap px-2 py-1 font-mono">{h.ordendecargue}</td>
                                  <td className="whitespace-nowrap px-2 py-1">{TIPO_LABEL[h.tipooperacion]}</td>
                                  <td className="whitespace-nowrap px-2 py-1 font-mono">{h.placa || "—"}</td>
                                  <td className="whitespace-nowrap px-2 py-1 text-center tabular-nums">{h.muelle ?? "—"}</td>
                                  <td className="whitespace-nowrap px-2 py-1">
                                    <span
                                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                        h.estado === "cerrada"
                                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                          : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                      }`}
                                    >
                                      {h.estado === "cerrada" ? `Cerrada ${fmtHora(h.horaCierre)}` : "En curso"}
                                    </span>
                                    {h.rezagada && (
                                      <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                                        de un día anterior
                                      </span>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-2 py-1">{h.modoCarga || "—"}</td>
                                  {/* La única columna que puede ser muy larga.
                                      Se deja en una línea y se corta con "…";
                                      el listado completo queda en el tooltip. */}
                                  <td className="px-2 py-1 text-muted-foreground">
                                    <span
                                      className="block max-w-[22rem] truncate"
                                      title={h.personalReal.length > 0 ? h.personalReal.join(", ") : undefined}
                                    >
                                      {h.personalReal.length > 0 ? h.personalReal.join(", ") : "—"}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Diálogo: asignar a muelle / iniciar / reasignar */}
      <Dialog open={!!asignarDialogOrder} onOpenChange={(open) => !open && setAsignarDialogOrder(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{asignarDialogOrder?.muelle ? "Reasignar a otro muelle" : "Iniciar orden en muelle"}</DialogTitle>
            <DialogDescription className="text-sm">
              {asignarDialogOrder?.ordendecargue} · {asignarDialogOrder?.cliente}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Muelle</Label>
            <Select value={muelleElegido} onValueChange={setMuelleElegido}>
              <SelectTrigger>
                <SelectValue placeholder="Elige un muelle libre" />
              </SelectTrigger>
              <SelectContent>
                {muellesLibres.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    Muelle {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {muellesLibres.length === 0 && <p className="text-xs text-rose-600">No hay muelles libres ahora mismo.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsignarDialogOrder(null)} disabled={asignando}>
              Cancelar
            </Button>
            <Button onClick={confirmarAsignar} disabled={asignando || !muelleElegido}>
              {asignando ? "..." : asignarDialogOrder?.muelle ? "Reasignar" : "Iniciar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: asignar personal (mismo flujo real de Picking/Packing) */}
      {/* Desglose de la espera por lotes. El promedio de la tarjeta dice que
          hay un problema; esto dice en QUE orden esta. Las que siguen sin
          lotes van primero: son las unicas sobre las que se puede hacer algo
          ahora. */}
      <Dialog open={verEsperaLotes} onOpenChange={setVerEsperaLotes}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-base">Espera por asignación de lotes</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Desde que se crea la orden de cargue hasta que se le asignan los lotes. Solo cargue:
              descargue y distribución no pasan por asignación de lotes.
            </p>
          </DialogHeader>

          {!data?.kpis.esperaLotesDetalle?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay órdenes de cargue hoy.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-left text-[11px] text-muted-foreground">
                      <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Orden</th>
                      <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Cliente</th>
                      <th className="whitespace-nowrap px-2 py-1.5 font-semibold">Placa</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-center font-semibold">Creada</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-center font-semibold">Lotes</th>
                      <th className="whitespace-nowrap px-2 py-1.5 text-right font-semibold">Espera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.kpis.esperaLotesDetalle.map((d, i) => {
                      const pendiente = !d.horalote
                      const min = pendiente ? d.esperandoMin : d.minutos
                      const color =
                        min === null
                          ? "text-muted-foreground"
                          : min >= 60
                            ? "text-rose-700 dark:text-rose-300"
                            : min >= 30
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-emerald-700 dark:text-emerald-300"
                      return (
                        <tr
                          key={d.ordendecargue + i}
                          className={pendiente ? "bg-rose-50/60 dark:bg-rose-950/20" : i % 2 ? "bg-muted/40" : ""}
                        >
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-xs">{d.ordendecargue}</td>
                          <td className="max-w-[14rem] truncate px-2 py-1 text-xs" title={d.cliente}>
                            {d.cliente}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-xs text-muted-foreground">
                            {d.placa || "—"}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-center font-mono text-xs tabular-nums">
                            {fmtHora(d.horaorden)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-center font-mono text-xs tabular-nums">
                            {d.horalote ? (
                              fmtHora(d.horalote)
                            ) : (
                              <span className="font-sans text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                                sin asignar
                              </span>
                            )}
                          </td>
                          <td className={`whitespace-nowrap px-2 py-1 text-right text-xs font-bold tabular-nums ${color}`}>
                            {min === null ? "—" : fmtDuracion(min)}
                            {pendiente && min !== null && (
                              <span className="ml-1 font-normal text-[10px] opacity-80">y contando</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
            <span>
              Promedio{" "}
              <b className="tabular-nums text-foreground">
                {data?.kpis.esperaLotesPromedioMin ?? "—"} min
              </b>{" "}
              sobre {data?.kpis.esperaLotesBaseOrdenes ?? 0} órdenes ya resueltas
            </span>
            {!!data?.kpis.esperaLotesPendientes && (
              <span className="font-semibold text-rose-700 dark:text-rose-300">
                {data.kpis.esperaLotesPendientes} todavía sin lotes
              </span>
            )}
            <span className="ml-auto">verde &lt;30 min · ámbar 30–59 · rojo ≥60</span>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!personnelDialogOrder} onOpenChange={(open) => !open && setPersonnelDialogOrder(null)}>
        <DialogContent className="max-w-md w-[95vw]">
          <DialogHeader>
            <DialogTitle className="text-base">Asignar Personal</DialogTitle>
            <DialogDescription className="text-sm" asChild>
              <span className="block">
                <span className="block">Orden: {personnelDialogOrder?.ordendecargue}</span>
                <span className="mt-1 block">Usuario: {profile?.usuario || "Usuario desconocido"}</span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="cc-auxiliares" className="text-sm font-medium">
                Auxiliares (opcional)
              </Label>
              <Input
                id="cc-auxiliares"
                placeholder="Ingrese los nombres de los auxiliares..."
                value={auxiliaresInput}
                onChange={(e) => setAuxiliaresInput(e.target.value)}
                className="text-sm"
              />
            </div>
            {loadingPersonnel ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Cargando personal...</div>
            ) : personnel.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No hay personal disponible</div>
            ) : (
              <div className="space-y-2">
                {personnelDialogOrder?.pausado && selectedPersonnel.length > 0 && (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setSelectedPersonnel([])}
                    >
                      Quitar todos
                    </Button>
                  </div>
                )}
                <div className="max-h-96 space-y-2 overflow-y-auto">
                  {personnel.map((employee) => (
                    <div key={employee.id} className="flex items-center space-x-2 rounded border p-2">
                      <Checkbox
                        id={`cc-employee-${employee.id}`}
                        checked={selectedPersonnel.includes(employee.nombreempleado)}
                        onCheckedChange={() => togglePersonnelSelection(employee.nombreempleado)}
                      />
                      <Label htmlFor={`cc-employee-${employee.id}`} className="flex-1 cursor-pointer text-sm font-normal">
                        {employee.nombreempleado}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPersonnelDialogOrder(null)} disabled={assigningPersonnel} className="flex-1">
              Cancelar
            </Button>
            <Button
              onClick={confirmarPersonal}
              disabled={assigningPersonnel || (selectedPersonnel.length === 0 && !personnelDialogOrder?.pausado)}
              className="flex-1"
            >
              {assigningPersonnel
                ? "..."
                : selectedPersonnel.length === 0
                  ? "Quitar todo el personal"
                  : `Asignar (${selectedPersonnel.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Personal de apoyo sobre la orden del muelle. El diálogo es el MISMO
          que usa el módulo "Asignación de apoyo en cargue" (componente
          compartido): si fueran dos copias, el reparto de toneladas podría
          mostrarse distinto según por dónde se entre, y ese número es plata. */}
      <ApoyoCargueDialog
        orden={ordenApoyo}
        fecha={hoyColombia()}
        empresaId={selectedEmpresaId}
        onCerrar={() => setOrdenApoyo(null)}
        onAgregado={cargar}
      />

      {photoOrder && (
        <PickingPhotoUploadDialog
          open={photoDialogOpen}
          onOpenChange={setPhotoDialogOpen}
          orderId={photoOrder.orderId}
          orderLabel={photoOrder.ordendecargue}
          title={photoOrder.tipooperacion === "Cargue" ? "Cargar Fotos de Picking" : "Cargar Fotos de Packing"}
          onUploaded={cargar}
        />
      )}
    </div>
  )
}

function MuelleRow({
  slot,
  expanded,
  loadingHoja,
  hoja,
  onToggle,
  onAsignarPersonal,
  onAgregarApoyo,
  onCerrarFotos,
  onPausar,
  onQuitar,
  onReasignar,
  onCambioTipoPago,
  onCambioModoCarga,
  onIrAPicking,
  pausingOrder,
  puedeConcluirSinPersonal,
  metaPorHoraTrabajador,
  personalDisponibleCount,
  atenuado,
}: {
  slot: { muelle: number; orden: OrdenOperativa | null }
  expanded: boolean
  loadingHoja: boolean
  hoja: HojaMuelle | null
  onToggle: () => void
  onAsignarPersonal: () => void
  onAgregarApoyo: () => void
  onCerrarFotos: () => void
  onPausar: () => void
  onQuitar: () => void
  onReasignar: () => void
  onCambioTipoPago: () => void
  onCambioModoCarga: () => void
  onIrAPicking: () => void
  pausingOrder: string | null
  puedeConcluirSinPersonal: boolean
  metaPorHoraTrabajador: number
  personalDisponibleCount: number
  /** true = no coincide con el filtro de tipo activo — se atenúa, NUNCA se oculta (los muelles son un recurso físico real). */
  atenuado: boolean
}) {
  const o = slot.orden

  // Semáforo de 3 colores: verde=libre, amarillo=ocupado, rojo=fuera de tiempo.
  const estado: "libre" | "ocupado" | "vencido" = !o ? "libre" : o.slaVencido ? "vencido" : "ocupado"
  const badgeColor = { libre: "bg-emerald-600", ocupado: "bg-amber-500", vencido: "bg-rose-600" }[estado]
  const badgeTextColor = estado === "ocupado" ? "text-amber-950" : "text-white"
  const rowBg = { libre: "bg-emerald-50/60 border-emerald-200", ocupado: "bg-amber-50/60 border-amber-200", vencido: "bg-rose-50/60 border-rose-200" }[
    estado
  ]

  const progreso = o ? progresoOrden(o) : null
  // Lo que se DEBERÍA llevar a esta hora, según el personal REAL asignado a
  // esta orden y el tiempo transcurrido desde que inició — no un promedio
  // del proyecto, sino el cálculo puntual de este muelle.
  const esperado =
    o && o.auxiliares.length > 0 && o.minutosTranscurridos != null
      ? metaPorHoraTrabajador * o.auxiliares.length * (o.minutosTranscurridos / 60)
      : null
  const eta = o ? finProyectado(o) : null
  const pasos = o ? construirPasos(o) : []
  const pasoActual = pasos.find((p) => p.current)

  const auxiliaresLabel = o?.auxiliares.length ? o.auxiliares.join(", ") : null
  const gananciaReforzar = t2(metaPorHoraTrabajador)

  return (
    <div className={`rounded-lg border ${rowBg} dark:bg-card dark:border-border transition-opacity ${atenuado ? "opacity-40" : ""}`}>
      {/* CELULAR: 3 columnas (distintivo · contenido · flecha) y la caja de
          "finaliza aprox." baja a una segunda fila a lo ancho.
          TABLET/ESCRITORIO: las 4 columnas de siempre, en una sola fila.
          `minmax(0,1fr)` y no `1fr` a proposito: sin el minimo en 0 la columna
          del contenido no puede encogerse y `truncate` no recorta nada. */}
      <button
        type="button"
        onClick={onToggle}
        disabled={!o}
        className="grid w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 p-2 text-left disabled:cursor-default sm:grid-cols-[64px_minmax(0,1fr)_auto_auto] sm:gap-3 sm:p-2.5"
      >
        <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl sm:h-16 sm:w-16 ${badgeColor} ${badgeTextColor} shadow ${o?.slaEnRiesgo ? "animate-pulse" : ""}`}>
          <div className="text-xl font-bold leading-none sm:text-2xl">{slot.muelle}</div>
          <div className="mt-0.5 text-[7px] font-bold uppercase leading-tight tracking-wide sm:text-[8px]">
            {estado === "libre" ? "Libre" : estado === "vencido" ? "Fuera de tiempo" : o?.pausado ? "Pausado" : "Ocupado"}
          </div>
        </div>

        {o ? (
          <div className="min-w-0 space-y-1.5">
            {/* En ESCRITORIO, una sola línea: con un nombre de cliente largo la
                placa y el tipo se iban a un segundo renglón y la fila quedaba
                desalineada. Lo único que cede es el cliente, que se corta con
                "…" y conserva el tooltip.
                En CELULAR sí se permite bajar de línea (`flex-wrap`): forzar
                una sola línea en 360 px dejaba el nombre del cliente reducido a
                dos letras, que es peor que ocupar un renglón más. */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:flex-nowrap">
              <span className="shrink-0 rounded bg-black/5 px-1 text-[9px] font-bold text-muted-foreground dark:bg-white/10">OC</span>
              <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{o.ordendecargue}</span>
              <span className="min-w-0 truncate text-sm font-bold" title={o.cliente ?? undefined}>
                {o.cliente}
              </span>
              <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">{o.placa}</span>
              <Badge variant="outline" className="shrink-0 whitespace-nowrap text-[10px]">
                {TIPO_LABEL[o.tipooperacion]}
              </Badge>
              {o.rezagada && (
                <Badge variant="outline" className="shrink-0 whitespace-nowrap border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400">
                  Pendiente de un día anterior
                </Badge>
              )}
            </div>
            {/* En celular la barra y el texto van en renglones distintos: en una
                sola línea de 360 px el texto de toneladas quedaba cortado a la
                mitad y no se leía ni la capacidad ni el porcentaje. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-base leading-none">{iconoVehiculo(o.tipovehiculo)}</span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/10 dark:bg-white/10 sm:max-w-[160px] sm:flex-1">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${progreso!.pct}%` }} />
              </div>
              <span className="min-w-0 basis-full truncate text-[11px] tabular-nums text-muted-foreground sm:basis-auto sm:whitespace-nowrap">
                {t1(o.pesoorden)} t objetivo{o.capacidadVehiculo ? ` · cap. ${t1(o.capacidadVehiculo)} t (${o.tipovehiculo})` : ""} ·{" "}
                {progreso!.pct}% {progreso!.fuente}
              </span>
            </div>
            {auxiliaresLabel && <div className="truncate text-[11px] text-muted-foreground">👤 {auxiliaresLabel}</div>}
            {esperado != null && (
              <div className="text-[11px] text-muted-foreground">
                esperado a esta hora{" "}
                <b className="tabular-nums text-foreground">{t1(esperado)} t</b>{" "}
                <span className="text-[10px]">
                  ({o!.auxiliares.length} aux. × {t1((o!.minutosTranscurridos || 0) / 60)} h)
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">Sin orden asignada</div>
        )}

        {o && (
          <div
            /* En celular ocupa una segunda fila a lo ancho (col 2 y 3); en
               tablet vuelve a su columna propia de la primera fila. */
            className={`col-start-2 col-end-4 row-start-2 flex items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-center sm:col-start-3 sm:col-end-4 sm:row-start-1 sm:block sm:px-3 sm:py-2 ${estado === "vencido" ? "bg-rose-100 dark:bg-rose-950/40" : o.pausado ? "bg-amber-100 dark:bg-amber-950/40" : "bg-emerald-100 dark:bg-emerald-950/40"}`}
          >
            <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              {o.pausado ? "En pausa" : "Finaliza aprox."}
            </div>
            <div className={`text-base font-bold tabular-nums sm:text-lg ${estado === "vencido" ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
              {o.pausado ? "—" : eta || "—"}
            </div>
            <div className="text-[9px] text-muted-foreground">
              {o.pausado
                ? "reanuda para continuar"
                : estado === "vencido"
                  ? `+${o.minutosTranscurridos! - (o.slaMin || 0)} min`
                  : o.slaEnRiesgo
                    ? "⚠ poca holgura"
                    : "muelle libre"}
            </div>
          </div>
        )}

        {o && (
          <ChevronDown
            className={`col-start-3 col-end-4 row-start-1 h-4 w-4 shrink-0 self-center text-muted-foreground transition-transform sm:col-start-4 sm:col-end-5 ${expanded ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {expanded && o && (
        <div className="border-t bg-background/60 p-3">
          {/* Línea de pasos — solo referencia, no compite con toneladas/tiempos */}
          <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 border-b pb-2 text-[11px] text-muted-foreground">
            {pasos.map((p, i) => (
              <span key={p.label} className="flex items-center gap-1 whitespace-nowrap">
                {i > 0 && <span className="text-border">→</span>}
                <span className={p.done ? "text-foreground" : p.current ? "font-bold text-teal-700 dark:text-teal-400" : "opacity-50"}>
                  {p.done ? "✓" : p.current ? "●" : ""} {p.label}
                  {p.detail ? ` (${p.detail})` : ""}
                </span>
                <span className="text-[8px] opacity-60">{p.role === "op" ? "🚜" : ""}</span>
              </span>
            ))}
          </div>

          {(o.slaVencido || o.slaEnRiesgo) && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {o.auxiliares.length === 0
                ? `Sin personal asignado — reforzar con auxiliares (hay ${personalDisponibleCount} disponibles) para retomar el ritmo.`
                : `A este ritmo no alcanza a cerrar dentro del SLA — un auxiliar más sumaría ~${gananciaReforzar} t/h.`}
            </div>
          )}

          {/* Panel de acción — el paso actual, contextual según quién lo ejecuta */}
          {pasoActual?.role === "op" && pasoActual.label === "Realizar Picking" ? (
            <div className="space-y-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              <div>
                🚜 <strong className="text-foreground">Realizar Picking</strong> lo hace el operario de montacargas desde
                Picking (celular, con QR). Si lo vas a tramitar tú, se hace allá mismo: se verifica cada línea (lote y
                cantidad) y se confirma. Desde aquí no se aprueban líneas sin verificar.
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-teal-600 text-xs text-teal-800 hover:bg-teal-50 dark:text-teal-300"
                onClick={onIrAPicking}
              >
                <CheckSquare className="mr-1 h-3 w-3" />
                Ir a Picking de esta orden
              </Button>
            </div>
          ) : pasoActual?.role === "op" ? (
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              🚜 <strong className="text-foreground">{pasoActual.label}</strong> lo hace el operario de montacargas desde{" "}
              {o.tipooperacion === "Cargue" ? "Picking" : "Packing"} (celular{o.tipooperacion === "Cargue" ? ", con QR" : ""}) — aquí solo
              ves el avance en vivo, no se opera desde el Centro de Coordinación.
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border-[1.5px] border-teal-600 bg-teal-50/60 p-3 dark:bg-teal-950/20">
              <span className="text-xs text-muted-foreground">
                Paso actual: <strong className="text-foreground">{pasoActual?.label}</strong>
              </span>
              {pasoActual?.label === "Asignar Personal" ? (
                <Button size="sm" onClick={onAsignarPersonal}>
                  <UserPlus className="mr-1 h-3.5 w-3.5" /> Asignar personal
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={onCerrarFotos}
                  disabled={o.pausado || (!puedeConcluirSinPersonal && (!auxiliaresLabel || !o.tipoPago))}
                  title={
                    o.pausado
                      ? "Reanuda el cargue antes de cerrar"
                      : !puedeConcluirSinPersonal && !auxiliaresLabel
                        ? "Asigna personal antes de cerrar"
                        : !puedeConcluirSinPersonal && !o.tipoPago
                          ? "Elige tipo de pago antes de cerrar"
                          : undefined
                  }
                >
                  <Camera className="mr-1 h-3.5 w-3.5" /> Cargar fotos (cierra la OC)
                </Button>
              )}
            </div>
          )}

          {/* Acciones de utilidad — independientes del paso actual. "Personal"
              se puede reabrir cuantas veces haga falta (agregar o quitar
              gente) mientras la orden siga abierta, no solo la primera vez —
              por eso vive aquí y no solo como CTA del paso "Asignar Personal". */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Otras acciones</span>
            {o.iniciocargue && pasoActual?.label !== "Asignar Personal" && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAsignarPersonal}>
                <UserPlus className="mr-1 h-3 w-3" /> {auxiliaresLabel ? "Editar personal" : "Asignar personal"}
              </Button>
            )}
            {/* Personal de APOYO: gente de fuera del grupo de cargue --típicamente
                turno fijo-- que se SUMA al reparto de toneladas de esta orden.
                Es la misma función del módulo "Asignación de apoyo en cargue",
                pero sin salir a buscar la orden en una lista. */}
            {o.iniciocargue && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={onAgregarApoyo}
                title="Sumar personal de apoyo al reparto de toneladas de esta orden"
              >
                <HandHelping className="mr-1 h-3 w-3" /> Agregar personal de apoyo
              </Button>
            )}
            {o.iniciocargue && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onPausar} disabled={pausingOrder === o.ordendecargue}>
                {o.pausado ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
                {o.pausado ? "Reanudar" : "Pausar"}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReasignar}>
              🔄 Reasignar a otro muelle
            </Button>
            {!o.iniciocargue && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600" onClick={onQuitar}>
                ⛔ Liberar muelle
              </Button>
            )}
          </div>

          {!puedeConcluirSinPersonal && (
            <div className="mt-2">
              <TipoPagoSelector orderId={o.orderId} tipoPago={o.tipoPago} disabled={!!o.fincargue} onChanged={onCambioTipoPago} />
            </div>
          )}

          {o.requiereModoCarga && (
            <div className="mt-2">
              <ModoCargaSelector orderId={o.orderId} modoCarga={o.modoCarga} disabled={!!o.fincargue} onChanged={onCambioModoCarga} />
            </div>
          )}

          {/* Evidencias / detalle — bajo demanda */}
          <details className="mt-3 rounded-md border">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-muted-foreground">▸ Ver líneas y evidencias</summary>
            <div className="border-t p-3">
              {loadingHoja ? (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Cargando...
                </div>
              ) : !hoja ? (
                <p className="text-center text-xs text-muted-foreground">Sin datos.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded border bg-background p-2">
                    <div className="mb-1 text-xs font-semibold">Líneas ({hoja.lineas.length})</div>
                    <div className="max-h-40 space-y-1 overflow-y-auto">
                      {hoja.lineas.map((l) => (
                        <div key={l.id} className="flex items-center justify-between text-[11px]">
                          <span className="truncate">{l.producto}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {t2(l.cantidad)} {l.status && <Badge variant="outline" className="ml-1 text-[9px]">{l.status}</Badge>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded border bg-background p-2">
                    <div className="mb-1 text-xs font-semibold">Trazabilidad</div>
                    <div className="space-y-1">
                      {hoja.trazabilidad.map((ev) => (
                        <div key={ev.evento} className="flex items-center justify-between text-[11px]">
                          <span className={ev.hora ? "" : "text-muted-foreground"}>{ev.evento}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{fmtHora(ev.hora)}</span>
                        </div>
                      ))}
                    </div>
                    {/* Cuánto esperó ESTA orden por sus lotes. La lista de
                        arriba da las dos horas, pero restarlas de cabeza en
                        piso no es razonable: el dato que se pidió es el
                        intervalo, no los extremos. */}
                    {(() => {
                      const creacion = hoja.trazabilidad.find((e) => e.evento === "Creación de la orden")?.hora
                      const lotes = hoja.trazabilidad.find((e) => e.evento === "Asignación de lotes")?.hora
                      const min = minutosEntre(creacion, lotes)
                      if (min === null) {
                        return creacion && !lotes ? (
                          <div className="mt-2 rounded border border-dashed px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                            Todavía sin lotes asignados
                          </div>
                        ) : null
                      }
                      return (
                        <div
                          className={`mt-2 rounded px-2 py-1 text-[11px] ${
                            min >= 60
                              ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400"
                              : min >= 30
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                          }`}
                        >
                          Esperó <b className="tabular-nums">{fmtDuracion(min)}</b> por la asignación de lotes
                        </div>
                      )
                    })()}
                  </div>
                  <div className="space-y-2">
                    <div className="rounded border bg-background p-2">
                      <div className="mb-1 text-xs font-semibold">Auxiliares</div>
                      {hoja.auxiliares.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">Sin personal asignado.</p>
                      ) : (
                        hoja.auxiliares.map((a) => (
                          <div key={a.nombre} className="flex items-center justify-between text-[11px]">
                            <span className="truncate">{a.nombre}</span>
                            <span className="tabular-nums text-muted-foreground">{t2(a.tonPorHora)} t/h</span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="rounded border bg-background p-2">
                      <div className="mb-1 text-xs font-semibold">Evidencias</div>
                      {hoja.fotospicking.length === 0 && !hoja.evidenciaPreoperacional ? (
                        <p className="text-[11px] text-muted-foreground">Sin evidencias cargadas aún.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {hoja.evidenciaPreoperacional?.fotos.map((f, i) => (
                            <img key={`pre-${i}`} src={f || "/placeholder.svg"} alt="Preop" className="h-10 w-10 rounded object-cover" />
                          ))}
                          {hoja.fotospicking.map((f, i) => (
                            <img key={`pk-${i}`} src={f || "/placeholder.svg"} alt="Evidencia" className="h-10 w-10 rounded object-cover" />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
