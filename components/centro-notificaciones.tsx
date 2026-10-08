"use client"

/**
 * Centro de notificaciones de la barra superior.
 *
 * Antes la barra tenía 11 campanas independientes (una por tipo de alerta),
 * cada una con su propio Popover: en escritorio ocupaban media barra y en
 * celular se salían de la pantalla. Aquí se reúnen en UNA campana con el
 * total de pendientes y un panel por frentes (Operación, Inventario,
 * Personal, Facturación), ordenado por severidad, con acceso directo al
 * módulo donde se resuelve cada cosa (evento `lipgo:navigate-module`, el
 * mismo que usan LIPbot y los enlaces internos: el destino conserva su
 * PermissionGuard).
 *
 * Los hooks de alertas NO cambian: cada uno sigue validando su permiso y
 * refrescando a su ritmo (30 s – 2 min, solo con la pestaña visible). Este
 * componente solo los presenta.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  DollarSign,
  Package,
  ShieldAlert,
  Timer,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useAuth } from "@/components/auth-provider"
import { usePendingTurnos } from "@/hooks/usePendingTurnos"
import { usePreoperacionalAlerts } from "@/hooks/usePreoperacionalAlerts"
import { useRendimientoAlerts } from "@/hooks/useRendimientoAlerts"
import { useFacturasAlerts } from "@/hooks/useFacturasAlerts"
import { useCicloFacturacionAlerts } from "@/hooks/useCicloFacturacionAlerts"
import { useInventarioAlerts } from "@/hooks/useInventarioAlerts"
import { useEvaluacionesAlerts } from "@/hooks/useEvaluacionesAlerts"
import { useAsistenciaAlerts } from "@/hooks/useAsistenciaAlerts"
import { useOperacionesDiaAlerts } from "@/hooks/useOperacionesDiaAlerts"
import { useConteoCiclicoAlerts } from "@/hooks/useConteoCiclicoAlerts"
import { useAjustesInventarioAlerts } from "@/hooks/useAjustesInventarioAlerts"

type Nivel = "critico" | "atencion" | "info"
type Frente = "operacion" | "inventario" | "personal" | "facturacion"
type Hue = "rose" | "red" | "fuchsia" | "amber" | "orange" | "sky" | "blue" | "green" | "purple" | "teal" | "indigo"

interface Item {
  key: string
  titulo: ReactNode
  detalle?: ReactNode
  etiqueta?: ReactNode
}

interface Seccion {
  key: string
  titulo: string
  descripcion: string
  icono: LucideIcon
  hue: Hue
  nivel: Nivel
  frente: Frente
  /** `name` del módulo destino (lib/dashboard-data.ts). */
  modulo: string
  /** Texto corto del botón "Abrir …". */
  destino: string
  cantidad: number
  items: Item[]
}

/** Clases explícitas por tono: Tailwind solo compila lo que ve escrito. */
const HUE: Record<Hue, { icono: string; hover: string; chip: string; borde: string }> = {
  rose: { icono: "bg-rose-50 text-rose-600", hover: "hover:bg-rose-50/60", chip: "bg-rose-100 text-rose-700", borde: "border-rose-200 text-rose-700" },
  red: { icono: "bg-red-50 text-red-600", hover: "hover:bg-red-50/60", chip: "bg-red-100 text-red-700", borde: "border-red-200 text-red-700" },
  fuchsia: { icono: "bg-fuchsia-50 text-fuchsia-600", hover: "hover:bg-fuchsia-50/60", chip: "bg-fuchsia-100 text-fuchsia-700", borde: "border-fuchsia-200 text-fuchsia-700" },
  amber: { icono: "bg-amber-50 text-amber-600", hover: "hover:bg-amber-50/60", chip: "bg-amber-100 text-amber-700", borde: "border-amber-200 text-amber-700" },
  orange: { icono: "bg-orange-50 text-orange-600", hover: "hover:bg-orange-50/60", chip: "bg-orange-100 text-orange-700", borde: "border-orange-200 text-orange-700" },
  sky: { icono: "bg-sky-50 text-sky-600", hover: "hover:bg-sky-50/60", chip: "bg-sky-100 text-sky-700", borde: "border-sky-200 text-sky-700" },
  blue: { icono: "bg-blue-50 text-blue-600", hover: "hover:bg-blue-50/60", chip: "bg-blue-100 text-blue-700", borde: "border-blue-200 text-blue-700" },
  green: { icono: "bg-green-50 text-green-600", hover: "hover:bg-green-50/60", chip: "bg-green-100 text-green-700", borde: "border-green-200 text-green-700" },
  purple: { icono: "bg-purple-50 text-purple-600", hover: "hover:bg-purple-50/60", chip: "bg-purple-100 text-purple-700", borde: "border-purple-200 text-purple-700" },
  teal: { icono: "bg-teal-50 text-teal-600", hover: "hover:bg-teal-50/60", chip: "bg-teal-100 text-teal-700", borde: "border-teal-200 text-teal-700" },
  indigo: { icono: "bg-indigo-50 text-indigo-600", hover: "hover:bg-indigo-50/60", chip: "bg-indigo-100 text-indigo-700", borde: "border-indigo-200 text-indigo-700" },
}

const NIVEL: Record<Nivel, { orden: number; etiqueta: string; punto: string; insignia: string }> = {
  critico: { orden: 0, etiqueta: "Crítico", punto: "bg-rose-500", insignia: "bg-rose-600" },
  atencion: { orden: 1, etiqueta: "Requiere atención", punto: "bg-amber-500", insignia: "bg-amber-500" },
  info: { orden: 2, etiqueta: "Informativo", punto: "bg-sky-500", insignia: "bg-sky-600" },
}

const FRENTE: Record<Frente, string> = {
  operacion: "Operación",
  inventario: "Inventario",
  personal: "Personal",
  facturacion: "Facturación",
}
const ORDEN_FRENTES: Frente[] = ["operacion", "inventario", "personal", "facturacion"]

/** Ítems que se listan dentro de una sección antes de mandar al módulo. */
const MAX_ITEMS = 6

const fechaCorta = (s: string) => {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" })
}

export function CentroNotificaciones({ empresaId, userId }: { empresaId: number | null; userId?: string }) {
  // Todas las alertas son del ID del selector global (top-bar remonta este
  // componente con `key` por ID). Única excepción: Ciclo de Facturación, que
  // depende de la sesión (jefe/coordinador) y cubre todos sus proyectos.
  const { selectedEmpresaNombre } = useAuth()
  const { pendingSolicitudes, count: turnosCount } = usePendingTurnos(empresaId)
  const preop = usePreoperacionalAlerts(empresaId, userId)
  const rend = useRendimientoAlerts(empresaId, userId)
  const fact = useFacturasAlerts(empresaId, userId)
  const ciclo = useCicloFacturacionAlerts()
  const inv = useInventarioAlerts(empresaId, userId)
  const evals = useEvaluacionesAlerts(empresaId, userId)
  const asis = useAsistenciaAlerts(empresaId, userId)
  const ops = useOperacionesDiaAlerts(empresaId, userId)
  const conteo = useConteoCiclicoAlerts(empresaId, userId)
  const ajustes = useAjustesInventarioAlerts(empresaId, userId)

  const secciones = useMemo<Seccion[]>(() => {
    const out: Seccion[] = []

    // --- Inventario -------------------------------------------------------
    if (ajustes.hasPermission && ajustes.count > 0) {
      const porAprobar = ajustes.alerts.filter((a) => a.tipo === "pendiente").length
      out.push({
        key: "ajustes_inventario",
        titulo: "Ajustes manuales de inventario",
        descripcion:
          porAprobar > 0
            ? `${porAprobar} por aprobar · un ajuste manual puede tapar un error real`
            : "Ejecutados en los últimos 7 días (601/701/702)",
        icono: ShieldAlert,
        hue: "rose",
        nivel: porAprobar > 0 ? "critico" : "info",
        frente: "inventario",
        modulo: "Transacciones de Inventario",
        destino: "Aprobaciones pendientes",
        cantidad: ajustes.count,
        items: ajustes.alerts.map((a) => ({
          key: `${a.tipo}-${a.id}`,
          titulo: a.mensaje,
          detalle: a.motivo ? `Motivo: ${a.motivo}` : undefined,
          etiqueta: a.tipo === "pendiente" ? "Por aprobar" : "Ejecutado",
        })),
      })
    }
    if (conteo.hasPermission && conteo.count > 0) {
      out.push({
        key: "conteo_ciclico",
        titulo: "Conteo cíclico de inventario",
        descripcion: "Vencido (7+ días) o con diferencia sin ajuste aprobado",
        icono: ClipboardCheck,
        hue: "teal",
        nivel: "atencion",
        frente: "inventario",
        modulo: "Cuadre de Inventario",
        destino: "Cuadre de Inventario",
        cantidad: conteo.count,
        items: conteo.alerts.map((a, i) => ({
          key: `${a.tipo}-${a.cuadre_id ?? i}`,
          titulo: a.mensaje,
          etiqueta: a.tipo === "vencido" ? "Vencido" : "Diferencia",
        })),
      })
    }
    if (inv.hasPermission && inv.count > 0) {
      out.push({
        key: "stock_reservado",
        titulo: "Productos con stock reservado",
        descripcion: "Inventario reservado pendiente de salir",
        icono: Package,
        hue: "purple",
        nivel: "info",
        frente: "inventario",
        modulo: "Saldos por producto",
        destino: "Saldos por producto",
        cantidad: inv.count,
        items: inv.alerts.map((p) => ({
          key: String(p.idproducto),
          titulo: p.nombreproducto,
          detalle: (
            <span className="flex flex-wrap gap-x-3">
              <span className="truncate">{p.categoria} · {p.subcategoria}</span>
              <span>Disp: {p.stock_disp.toLocaleString("es-CO")}</span>
              <span>Total: {p.stock_global.toLocaleString("es-CO")}</span>
            </span>
          ),
          etiqueta: `Res: ${p.stock_res.toLocaleString("es-CO")}`,
        })),
      })
    }

    // --- Operación --------------------------------------------------------
    if (preop.hasPermission && preop.count > 0) {
      out.push({
        key: "prechequeo",
        titulo: "Incumplimientos de preoperacional",
        descripcion: "Últimos 8 días · Registro Preoperacional",
        icono: AlertTriangle,
        hue: "red",
        nivel: "critico",
        frente: "operacion",
        modulo: "Registro Preoperacional",
        destino: "Registro Preoperacional",
        cantidad: preop.count,
        items: preop.alerts.map((a, i) => ({
          key: `${a.id}-${a.campo}-${i}`,
          titulo: a.campo_label,
          detalle: (
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" />{a.placa}</span>
              <span className="truncate">Op: {a.nombre_operador}</span>
            </span>
          ),
          etiqueta: fechaCorta(a.fecha),
        })),
      })
    }
    if (ops.hasPermission && ops.count > 0) {
      out.push({
        key: "operaciones_dia",
        titulo: "Vehículos sin Ini.Op / Fin.Op",
        descripcion: "Operaciones del día sin hora de inicio o de fin",
        icono: Wrench,
        hue: "fuchsia",
        nivel: "atencion",
        frente: "operacion",
        modulo: "Dashboard Operacion",
        destino: "Operaciones del día",
        cantidad: ops.count,
        items: ops.alerts.map((op, i) => ({
          key: `${op.ordendecargue}-${i}`,
          titulo: (
            <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3 text-fuchsia-600" />{op.placa || "Sin placa"}</span>
          ),
          detalle: `${op.cliente}${op.ordendecargue ? ` · OC ${op.ordendecargue}` : ""}`,
          etiqueta: op.motivo,
        })),
      })
    }
    if (rend.hasPermission && rend.count > 0) {
      out.push({
        key: "rendimiento",
        titulo: "Operaciones lentas",
        descripcion: "En proceso hace más de 2 horas",
        icono: Timer,
        hue: "amber",
        nivel: "atencion",
        frente: "operacion",
        modulo: "Dashboard Operacion",
        destino: "Dashboard Operación",
        cantidad: rend.count,
        items: rend.alerts.map((a, i) => ({
          key: `${a.ordendecargue}-${i}`,
          titulo: `Orden ${a.ordendecargue}`,
          detalle: (
            <span className="flex items-center gap-2">
              <span className="truncate">{a.cliente}</span>
              <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" />{a.placa}</span>
              <span>{a.tipooperacion}</span>
            </span>
          ),
          etiqueta: (
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{a.tiempo_en_proceso}</span>
          ),
        })),
      })
    }

    // --- Personal ---------------------------------------------------------
    if (turnosCount > 0) {
      out.push({
        key: "turnos",
        titulo: "Solicitudes de turnos por aprobar",
        descripcion: "Turnos pedidos por el cliente o el coordinador",
        icono: Users,
        hue: "orange",
        nivel: "atencion",
        frente: "personal",
        modulo: "Aprobar Turnos",
        destino: "Aprobar Turnos",
        cantidad: turnosCount,
        items: pendingSolicitudes.map((s) => ({
          key: String(s.id),
          titulo: s.puesto,
          detalle: (
            <span className="flex flex-wrap items-center gap-x-3">
              <span className="truncate">Solicita: {s.nombresolicitante}</span>
              <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{fechaCorta(s.fecharequerida)}</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fechaCorta(s.fechasolicitud)}</span>
            </span>
          ),
          etiqueta: `${s.cantidad} turno${s.cantidad !== 1 ? "s" : ""}`,
        })),
      })
    }
    if (asis.hasPermission && asis.pendientesCount > 0) {
      out.push({
        key: "asistencia_pendientes",
        titulo: "Asistencia por procesar",
        descripcion: "Tabla del día · sin programada, registrada ni novedad",
        icono: ClipboardList,
        hue: "amber",
        nivel: "atencion",
        frente: "personal",
        modulo: "Tabla Asistencia",
        destino: "Tabla Asistencia",
        cantidad: asis.pendientesCount,
        items: asis.pendientes.map((p) => ({
          key: p.identificacion,
          titulo: p.nombre,
          detalle: `C.C. ${p.identificacion}`,
        })),
      })
    }
    if (asis.hasPermission && asis.sinSalidaCount > 0) {
      out.push({
        key: "asistencia_sin_salida",
        titulo: "Con llegada y sin hora de salida",
        descripcion: "Tabla del día · falta marcar la salida",
        icono: ClipboardCheck,
        hue: "sky",
        nivel: "info",
        frente: "personal",
        modulo: "Tabla Asistencia",
        destino: "Tabla Asistencia",
        cantidad: asis.sinSalidaCount,
        items: asis.sinSalida.map((p) => ({
          key: p.identificacion,
          titulo: p.nombre,
          detalle: `C.C. ${p.identificacion}`,
          etiqueta: (
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{p.horaLlegada}</span>
          ),
        })),
      })
    }
    if (evals.hasPermission && evals.count > 0) {
      out.push({
        key: "evaluaciones",
        titulo: "Evaluaciones de desempeño pendientes",
        descripcion: "Colaboradores sin evaluar o con más de 30 días",
        icono: ClipboardList,
        hue: "indigo",
        nivel: "info",
        frente: "personal",
        modulo: "Evaluaciones de Desempeño",
        destino: "Evaluaciones de Desempeño",
        cantidad: evals.count,
        items: evals.alerts.map((c) => ({
          key: String(c.id),
          titulo: c.nombre,
          detalle: c.cargo || "Sin cargo",
          etiqueta: c.dias_desde_ultima !== null ? `${c.dias_desde_ultima} días` : "Sin evaluar",
        })),
      })
    }

    // --- Facturación ------------------------------------------------------
    if (ciclo.hasPermission && ciclo.count > 0) {
      // El coordinador LIP de un proyecto va a su bandeja en Solicitar Facturas;
      // quien tiene los permisos globales del ciclo va al módulo del ciclo.
      const esBandejaCoordinador = ciclo.destino === "Solicitar Facturas"
      out.push({
        key: "ciclo_facturacion",
        titulo: esBandejaCoordinador ? "Firmas pendientes de tus clientes" : "Ciclo de facturación",
        descripcion: esBandejaCoordinador
          ? "Cartera LIP te envió anexos o facturas que esperan la firma del cliente"
          : "Te toca actuar en estos ciclos (todos tus proyectos)",
        icono: ClipboardCheck,
        hue: "blue",
        nivel: "atencion",
        frente: "facturacion",
        modulo: ciclo.destino,
        destino: ciclo.destino,
        cantidad: ciclo.count,
        items: ciclo.alerts.map((f) => ({
          key: String(f.id),
          titulo: f.owner,
          detalle: (
            <>
              <span className="block truncate">{f.proyecto} · {f.estado_ciclo}</span>
              {f.motivos?.includes("advertencias") && (
                <span className="block font-medium text-amber-600">⚠ Revisar advertencias de la generación automática</span>
              )}
            </>
          ),
        })),
      })
    }
    if (fact.hasPermission && fact.count > 0) {
      out.push({
        key: "facturas",
        titulo: "Órdenes por facturar",
        descripcion: "Solicitar Facturas · pendientes por procesar",
        icono: DollarSign,
        hue: "green",
        nivel: "atencion",
        frente: "facturacion",
        modulo: "Solicitar Facturas",
        destino: "Solicitar Facturas",
        cantidad: fact.count,
        items: fact.alerts.map((f) => ({
          key: String(f.id),
          titulo: `Orden ${f.ordendecargue}`,
          detalle: (
            <span className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1"><Truck className="h-3 w-3" />{f.placa}</span>
              <span className="truncate">{f.transporte}</span>
            </span>
          ),
          etiqueta: f.tipooperacion,
        })),
      })
    }

    return out.sort(
      (a, b) => NIVEL[a.nivel].orden - NIVEL[b.nivel].orden || b.cantidad - a.cantidad || a.titulo.localeCompare(b.titulo),
    )
  }, [
    ajustes.hasPermission, ajustes.count, ajustes.alerts,
    conteo.hasPermission, conteo.count, conteo.alerts,
    inv.hasPermission, inv.count, inv.alerts,
    preop.hasPermission, preop.count, preop.alerts,
    ops.hasPermission, ops.count, ops.alerts,
    rend.hasPermission, rend.count, rend.alerts,
    turnosCount, pendingSolicitudes,
    asis.hasPermission, asis.pendientesCount, asis.pendientes, asis.sinSalidaCount, asis.sinSalida,
    evals.hasPermission, evals.count, evals.alerts,
    ciclo.hasPermission, ciclo.count, ciclo.alerts, ciclo.destino,
    fact.hasPermission, fact.count, fact.alerts,
  ])

  const total = secciones.reduce((s, x) => s + x.cantidad, 0)
  const nivelMax: Nivel = secciones[0]?.nivel ?? "info"
  const frentes = ORDEN_FRENTES.filter((f) => secciones.some((s) => s.frente === f))
  const porFrente = (f: Frente) => secciones.filter((s) => s.frente === f).reduce((s, x) => s + x.cantidad, 0)

  const [open, setOpen] = useState(false)
  const [frente, setFrente] = useState<Frente | "todas">("todas")
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})

  // "Visto": la insignia pulsa solo cuando hay algo distinto a la última vez
  // que se abrió el panel. Se guarda en sessionStorage porque la barra se
  // vuelve a montar al navegar (ErrorBoundary de app/page.tsx).
  const firma = secciones.map((s) => `${s.key}:${s.cantidad}`).join("|")
  const claveVista = `lipgo:notif:vista:${userId ?? "anon"}`
  const [firmaVista, setFirmaVista] = useState("")
  useEffect(() => {
    try {
      setFirmaVista(sessionStorage.getItem(claveVista) ?? "")
    } catch {
      /* sin almacenamiento: la insignia pulsa siempre */
    }
  }, [claveVista])
  const marcarVisto = () => {
    setFirmaVista(firma)
    try {
      sessionStorage.setItem(claveVista, firma)
    } catch {
      /* ignorar */
    }
  }
  const hayNuevo = total > 0 && firma !== firmaVista

  const frenteActivo: Frente | "todas" = frente !== "todas" && !frentes.includes(frente) ? "todas" : frente
  const visibles = frenteActivo === "todas" ? secciones : secciones.filter((s) => s.frente === frenteActivo)

  const irA = (modulo: string) => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent("lipgo:navigate-module", { detail: modulo }))
  }
  // Abrir la pantalla donde se gestiona la sección. Donde existe un salto con
  // filtro (Solicitar Facturas ya filtrada en "pendiente", mismo evento que usa
  // Ciclo de Facturación) se usa; si no, se abre el módulo.
  const abrirSeccion = (s: Seccion) => {
    if (s.key === "facturas") {
      setOpen(false)
      window.dispatchEvent(new CustomEvent("lipgo:ir-a-gestionar-facturas", { detail: { estado: "pendiente" } }))
      return
    }
    irA(s.modulo)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) marcarVisto()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative rounded-lg p-1 transition-colors hover:bg-accent sm:p-2"
          title={total > 0 ? `Notificaciones: ${total} pendiente${total !== 1 ? "s" : ""}` : "Notificaciones: todo al día"}
          aria-label={total > 0 ? `Notificaciones, ${total} pendientes` : "Notificaciones, todo al día"}
        >
          <Bell className={cn("h-4 w-4 sm:h-5 sm:w-5", total > 0 ? "text-foreground" : "text-muted-foreground")} />
          {total > 0 && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                NIVEL[nivelMax].insignia,
                hayNuevo && "animate-pulse",
              )}
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={8} className="w-[min(26rem,calc(100vw-1rem))] overflow-hidden p-0">
        <div className="border-b bg-muted/40 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="h-4 w-4" />
              Notificaciones
              {empresaId != null && (
                <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  ID {empresaId}
                  {selectedEmpresaNombre ? ` · ${selectedEmpresaNombre}` : ""}
                </span>
              )}
            </h4>
            <span className="text-xs text-muted-foreground">
              {total > 0
                ? `${total} pendiente${total !== 1 ? "s" : ""} · ${secciones.length} frente${secciones.length !== 1 ? "s" : ""}`
                : "Todo al día"}
            </span>
          </div>
          {frentes.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <ChipFrente activo={frenteActivo === "todas"} onClick={() => setFrente("todas")} etiqueta="Todas" n={total} />
              {frentes.map((f) => (
                <ChipFrente key={f} activo={frenteActivo === f} onClick={() => setFrente(f)} etiqueta={FRENTE[f]} n={porFrente(f)} />
              ))}
            </div>
          )}
        </div>

        <div className="max-h-[min(70vh,34rem)] overflow-y-auto">
          {visibles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-medium">Todo al día</p>
              <p className="text-xs text-muted-foreground">
                No hay pendientes que requieran tu atención{frenteActivo !== "todas" ? " en este frente" : ""}.
              </p>
            </div>
          ) : (
            visibles.map((s, i) => {
              // Pocas secciones: todas abiertas; muchas: solo la más grave.
              const abierta = abiertas[s.key] ?? (i === 0 || visibles.length <= 3)
              const toggle = () => setAbiertas((prev) => ({ ...prev, [s.key]: !abierta }))
              const Icono = s.icono
              const tono = HUE[s.hue]
              return (
                <div key={s.key} className="border-b last:border-b-0">
                  {/* Cabecera: el texto despliega el detalle; "Abrir" lleva a la pantalla
                      donde se gestiona (siempre visible, sin tener que desplegar). */}
                  <div className={cn("flex items-center gap-2 px-3 py-2.5 transition-colors sm:px-4", tono.hover)}>
                    <button type="button" onClick={toggle} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-expanded={abierta}>
                      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tono.icono)}>
                        <Icono className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{s.titulo}</span>
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", NIVEL[s.nivel].punto)} title={NIVEL[s.nivel].etiqueta} />
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{s.descripcion}</span>
                      </span>
                    </button>
                    <Badge variant="secondary" className={cn("shrink-0 px-1.5 text-xs", tono.chip)}>{s.cantidad}</Badge>
                    <button
                      type="button"
                      onClick={() => abrirSeccion(s)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-accent"
                      title={`Abrir ${s.destino}`}
                    >
                      Abrir
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={toggle} className="shrink-0 rounded p-1 hover:bg-background" aria-label={abierta ? "Ocultar detalle" : "Ver detalle"}>
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", abierta && "rotate-180")} />
                    </button>
                  </div>
                  {abierta && (
                    <div className="bg-muted/20 pb-1">
                      <div className="divide-y border-t">
                        {/* Cada fila también abre la pantalla de gestión. */}
                        {s.items.slice(0, MAX_ITEMS).map((it) => (
                          <button
                            key={it.key}
                            type="button"
                            onClick={() => abrirSeccion(s)}
                            title={`Abrir ${s.destino}`}
                            className="group flex w-full items-start justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-background sm:px-4"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{it.titulo}</span>
                              {it.detalle && <span className="mt-0.5 block text-xs text-muted-foreground">{it.detalle}</span>}
                            </span>
                            {it.etiqueta && (
                              <Badge variant="outline" className={cn("shrink-0 text-[11px]", tono.borde)}>{it.etiqueta}</Badge>
                            )}
                            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" />
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 sm:px-4">
                        <span className="truncate text-[11px] text-muted-foreground">
                          {s.cantidad > MAX_ITEMS ? `y ${s.cantidad - MAX_ITEMS} más` : NIVEL[s.nivel].etiqueta}
                        </span>
                        <button type="button" onClick={() => abrirSeccion(s)} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                          Ver todo en {s.destino}
                          <ArrowUpRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Se actualiza sola cada 1–2 min mientras la pestaña está visible.
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ChipFrente({ activo, onClick, etiqueta, n }: { activo: boolean; onClick: () => void; etiqueta: string; n: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        activo ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {etiqueta}
      <span className={cn("ml-1", activo ? "opacity-80" : "opacity-70")}>{n}</span>
    </button>
  )
}
