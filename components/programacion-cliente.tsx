"use client"

// PROGRAMACIÓN DEL CLIENTE — Pedidos y solicitudes › "Programación de mañana"
// (modo "cliente") y Torre de Control › "Programación del cliente · cumplimiento"
// (modo "lip"). Es la MISMA pantalla: registrar o corregir la programación de
// vehículos de un día (cantidad · tipo de vehículo · destino o ruta · producto)
// y ver el cumplimiento por día: programado vs. llegado a portería, por tipo.
//
// Reglas (gerencia 2026-10-01):
//   - La registran el cliente o el coordinador LIP por él (queda quién la envió).
//   - Hora límite 5:00 p. m. del día anterior; después queda marcada "tarde".
//   - Cada cambio guarda una versión nueva; la última es la vigente.
//   - El cumplimiento se mide por tipo de vehículo (portería no registra destino).
// Datos: lib/programacion-cliente-actions.ts (tabla programacion_cliente, SQL 211).

import { useCallback, useEffect, useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, Clock, Loader2, Pencil, Plus, Send, Trash2, Truck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { cn } from "@/lib/utils"
import { Chip, Cifra, Esqueleto, Eyebrow } from "@/components/ui/lipgo"
import { getCatalogosProgramacion, getCumplimientoProgramacion, getProgramacion, guardarProgramacion } from "@/lib/programacion-cliente-actions"
import {
  HORA_LIMITE,
  HORA_LIMITE_TEXTO,
  type CatalogosProgramacion,
  type CumplimientoDia,
  type CumplimientoResumen,
  type LineaProgramacion,
  type ProgramacionCliente as Programacion,
} from "@/lib/programacion-cliente-tipos"
import { sumarDias } from "@/lib/programacion-cliente-calculo"

const TZ = "America/Bogota"
const hoyBogota = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
const horaBogota = () => Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()))
const fechaLarga = (iso: string) => {
  const s = new Date(`${iso}T12:00:00-05:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: TZ })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00-05:00`).toLocaleDateString("es-CO", { day: "2-digit", month: "short", timeZone: TZ })
const fechaHora = (ts: string) => new Date(ts).toLocaleString("es-CO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ })
const pad = (n: number) => String(n).padStart(2, "0")
const NUM = new Intl.NumberFormat("es-CO")

type Preset = "semana" | "quincena" | "mes" | "mes_anterior"
const PRESETS: { key: Preset; label: string }[] = [
  { key: "semana", label: "Esta semana" },
  { key: "quincena", label: "Quincena" },
  { key: "mes", label: "Este mes" },
  { key: "mes_anterior", label: "Mes anterior" },
]
function rangoDe(p: Preset, hoy: string): { desde: string; hasta: string } {
  const [y, m, d] = hoy.split("-").map(Number)
  if (p === "semana") {
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // lunes = 0
    return { desde: sumarDias(hoy, -dow), hasta: hoy }
  }
  if (p === "quincena") return { desde: d <= 15 ? `${y}-${pad(m)}-01` : `${y}-${pad(m)}-16`, hasta: hoy }
  if (p === "mes") return { desde: `${y}-${pad(m)}-01`, hasta: hoy }
  const pm = m === 1 ? 12 : m - 1
  const py = m === 1 ? y - 1 : y
  const ultimo = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  return { desde: `${py}-${pad(pm)}-01`, hasta: `${py}-${pad(pm)}-${pad(ultimo)}` }
}

const lineaVacia = (): LineaProgramacion => ({ tipovehiculo: "", destino: "", producto: "", cantidad: 1, observaciones: "" })
const colorPct = (p: number | null) => (p == null ? "#64748b" : p >= 90 ? "#0f766e" : p >= 70 ? "#d97706" : "#dc2626")
const tonoPct = (p: number | null): "neutro" | "ok" | "atencion" | "critico" => (p == null ? "neutro" : p >= 90 ? "ok" : p >= 70 ? "atencion" : "critico")

/**
 * modo:
 *   "lip"      → Operación LIP › Operación del día › Programación de mañana: el
 *                coordinador CONSIGNA lo que envía el cliente (responsable).
 *   "cliente"  → Pedidos y solicitudes › Programación de mañana: el cliente la
 *                registra si quiere (opcional). Misma pantalla.
 *   "gerencia" → Torre de Control: cumplimiento primero; también puede consignar.
 */
export function ProgramacionCliente({ modo }: { modo: "cliente" | "lip" | "gerencia" }) {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const { toast } = useToast()
  const hoy = hoyBogota()
  const manana = sumarDias(hoy, 1)

  // ---- Programación de un día -----------------------------------------------
  const [fecha, setFecha] = useState(manana)
  const [cat, setCat] = useState<CatalogosProgramacion | null>(null)
  const [errorCat, setErrorCat] = useState<string | null>(null)
  const [prog, setProg] = useState<{ vigente: Programacion | null; versiones: Programacion[] } | null>(null)
  const [cargandoProg, setCargandoProg] = useState(true)
  const [lineas, setLineas] = useState<LineaProgramacion[]>([lineaVacia()])
  const [obs, setObs] = useState("")
  const [editando, setEditando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [verVersiones, setVerVersiones] = useState(false)

  useEffect(() => {
    if (!selectedEmpresaId) return
    let vivo = true
    getCatalogosProgramacion(selectedEmpresaId).then((r) => {
      if (!vivo) return
      if (r.success) {
        setCat(r.data)
        setErrorCat(null)
      } else setErrorCat(r.message)
    })
    return () => {
      vivo = false
    }
  }, [selectedEmpresaId])

  const cargarProgramacion = useCallback(async () => {
    if (!selectedEmpresaId) return
    setCargandoProg(true)
    const r = await getProgramacion(selectedEmpresaId, fecha)
    setCargandoProg(false)
    if (!r.success) {
      setProg(null)
      setErrorCat((e) => e ?? r.message)
      return
    }
    setProg(r.data)
    if (r.data.vigente) {
      setLineas(r.data.vigente.lineas.map((l) => ({ ...l, producto: l.producto ?? "", observaciones: l.observaciones ?? "" })))
      setObs(r.data.vigente.observaciones ?? "")
      setEditando(false)
    } else {
      setLineas([lineaVacia()])
      setObs("")
      setEditando(true)
    }
    setVerVersiones(false)
  }, [selectedEmpresaId, fecha])
  useEffect(() => {
    cargarProgramacion()
  }, [cargarProgramacion])

  // ---- Cumplimiento -----------------------------------------------------------
  const [preset, setPreset] = useState<Preset | "otro">("quincena")
  const [rango, setRango] = useState(() => rangoDe("quincena", hoyBogota()))
  const [cump, setCump] = useState<CumplimientoResumen | null>(null)
  const [cargandoCump, setCargandoCump] = useState(false)
  const [errorCump, setErrorCump] = useState<string | null>(null)
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)

  const cargarCumplimiento = useCallback(async () => {
    if (!selectedEmpresaId || !rango.desde || !rango.hasta || rango.desde > rango.hasta) return
    setCargandoCump(true)
    const r = await getCumplimientoProgramacion(selectedEmpresaId, rango.desde, rango.hasta)
    setCargandoCump(false)
    if (r.success) {
      setCump(r.data)
      setErrorCump(null)
    } else {
      setCump(null)
      setErrorCump(r.message)
    }
  }, [selectedEmpresaId, rango.desde, rango.hasta])
  useEffect(() => {
    cargarCumplimiento()
  }, [cargarCumplimiento])

  const elegirPreset = (p: Preset) => {
    setPreset(p)
    setRango(rangoDe(p, hoyBogota()))
  }

  // ---- Edición de líneas --------------------------------------------------------
  const actualizar = (i: number, patch: Partial<LineaProgramacion>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const agregar = () => setLineas((ls) => [...ls, lineaVacia()])
  const quitar = (i: number) => setLineas((ls) => (ls.length === 1 ? [lineaVacia()] : ls.filter((_, j) => j !== i)))
  const total = useMemo(() => lineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0), [lineas])

  const limite = `${fechaCorta(sumarDias(fecha, -1))} ${HORA_LIMITE_TEXTO}`
  const yaPasoLimite = Date.now() > Date.parse(`${sumarDias(fecha, -1)}T${pad(HORA_LIMITE)}:00:00-05:00`)

  const guardar = async () => {
    if (!selectedEmpresaId) return
    const limpias = lineas
      .map((l) => ({ ...l, cantidad: Math.floor(Number(l.cantidad) || 0), tipovehiculo: l.tipovehiculo.trim(), destino: l.destino.trim() }))
      .filter((l) => l.tipovehiculo || l.destino || l.producto)
    if (limpias.length === 0) {
      toast({ title: "Falta la programación", description: "Agrega al menos una línea con cantidad y tipo de vehículo.", variant: "destructive" })
      return
    }
    const mala = limpias.find((l) => !l.tipovehiculo || l.cantidad < 1)
    if (mala) {
      toast({ title: "Revisa las líneas", description: "Cada línea necesita tipo de vehículo y una cantidad de 1 o más.", variant: "destructive" })
      return
    }
    setGuardando(true)
    const r = await guardarProgramacion(selectedEmpresaId, fecha, limpias, obs)
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    toast({
      title: r.data.version > 1 ? `Versión ${r.data.version} guardada` : "Programación enviada",
      description: r.data.aTiempo ? "Llegó a tiempo." : `Llegó después de las ${HORA_LIMITE_TEXTO} del día anterior: queda marcada como tarde.`,
    })
    setCat((c) => (c ? { ...c, usa: true } : c))
    await cargarProgramacion()
    await cargarCumplimiento()
  }

  const vigente = prog?.vigente ?? null
  const esCliente = modo === "cliente"

  if (!selectedEmpresaId) {
    return <div className="p-6 text-sm text-muted-foreground">Selecciona un proyecto para ver su programación.</div>
  }

  return (
    <div className="flex flex-col gap-4 p-2 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acento-tinte text-acento">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              {modo === "gerencia" ? "Programación del cliente · cumplimiento" : modo === "lip" ? "Programación del cliente para mañana" : "Programación de mañana"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {modo === "lip"
                ? `Consigna aquí la programación de vehículos que ${selectedEmpresaNombre || "el cliente"} envía para mañana (hora límite ${HORA_LIMITE_TEXTO}). El cliente también puede registrarla desde Pedidos y solicitudes; vale la última versión.`
                : esCliente
                  ? `Si quieres, registra aquí los vehículos que llegarán mañana a ${selectedEmpresaNombre || "la planta"} en vez de enviárselos al coordinador (hora límite ${HORA_LIMITE_TEXTO}). Aquí también ves cuánto se cumplió cada día.`
                  : `Lo que ${selectedEmpresaNombre || "el cliente"} programó para cada día y cuánto se cumplió en portería. También puedes consignar o corregir una programación.`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={fecha === manana ? "default" : "outline"} onClick={() => setFecha(manana)}>
            Mañana · {fechaCorta(manana)}
          </Button>
          <Button size="sm" variant={fecha === hoy ? "default" : "outline"} onClick={() => setFecha(hoy)}>
            Hoy
          </Button>
          <Input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} className="h-8 w-[150px] text-xs" />
        </div>
      </div>

      {errorCat && (
        <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-3 text-xs text-atencion-fg">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" /> {errorCat}
          </p>
        </div>
      )}

      {/* Estado del día elegido (en gerencia va después del cumplimiento) */}
      <section className={cn("lg-card", modo === "gerencia" && "order-2")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <Eyebrow>Programación para</Eyebrow>
            <h2 className="text-[15px] font-bold leading-tight">{fechaLarga(fecha)}</h2>
          </div>
          {cargandoProg ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
            </span>
          ) : vigente ? (
            <span
              className={cn(
                "inline-flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                vigente.aTiempo ? "border-ok-bd bg-ok-bg text-ok-fg" : "border-atencion-bd bg-atencion-bg text-atencion-fg",
              )}
            >
              {vigente.aTiempo ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
              <span>
                Enviada {fechaHora(vigente.enviadaEn)}
                {vigente.enviadaPorUsuario ? ` por ${vigente.enviadaPorUsuario}` : ""} · {vigente.aTiempo ? "a tiempo" : "tarde"} · versión {vigente.version} ·{" "}
                {vigente.totalVehiculos} vehículo{vigente.totalVehiculos === 1 ? "" : "s"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-atencion-bd bg-atencion-bg px-2 py-1 text-xs text-atencion-fg">
              <AlertTriangle className="h-3.5 w-3.5" />
              Sin programación · hora límite {limite}
              {yaPasoLimite ? " (ya pasó: lo que envíes queda como tarde)" : ""}
            </span>
          )}
        </div>

        {/* Resumen de la vigente (lectura) */}
        {!editando && vigente && (
          <div className="px-4 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left lg-eyebrow">
                  <th className="py-1 pr-2 text-right">Cant.</th>
                  <th className="py-1 pr-2">Tipo de vehículo</th>
                  <th className="py-1 pr-2">Destino / ruta</th>
                  <th className="hidden py-1 pr-2 sm:table-cell">Producto</th>
                  <th className="hidden py-1 md:table-cell">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vigente.lineas.map((l, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{l.cantidad}</td>
                    <td className="py-1.5 pr-2">{l.tipovehiculo}</td>
                    <td className="py-1.5 pr-2">{l.destino || <span className="text-muted-foreground">—</span>}</td>
                    <td className="hidden py-1.5 pr-2 sm:table-cell">{l.producto || <span className="text-muted-foreground">—</span>}</td>
                    <td className="hidden py-1.5 text-xs text-muted-foreground md:table-cell">{l.observaciones || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vigente.observaciones && <p className="mt-2 text-xs text-muted-foreground">Observaciones: {vigente.observaciones}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setVerVersiones((v) => !v)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", verVersiones && "rotate-180")} />
                {prog!.versiones.length} versión{prog!.versiones.length === 1 ? "" : "es"}
              </button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditando(true)}>
                <Pencil className="h-3.5 w-3.5" /> Modificar (nueva versión)
              </Button>
            </div>
            {verVersiones && (
              <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                {prog!.versiones.map((v) => (
                  <li key={v.id}>
                    v{v.version} · {fechaHora(v.enviadaEn)}
                    {v.enviadaPorUsuario ? ` · ${v.enviadaPorUsuario}` : ""} · {v.aTiempo ? "a tiempo" : "tarde"} · {v.totalVehiculos} vehículo{v.totalVehiculos === 1 ? "" : "s"}
                    {v.vigente ? " · vigente" : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Formulario */}
        {editando && (
          <div className="px-4 py-3">
            <datalist id="prog-destinos">{(cat?.destinos ?? []).map((d) => <option key={d} value={d} />)}</datalist>
            <datalist id="prog-productos">{(cat?.productos ?? []).map((p) => <option key={p} value={p} />)}</datalist>
            <div className="space-y-2">
              <div className="hidden grid-cols-[72px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_32px] gap-2 lg-eyebrow md:grid">
                <span>Cant.</span>
                <span>Tipo de vehículo</span>
                <span>Destino / ruta</span>
                <span>Producto</span>
                <span>Observación</span>
                <span />
              </div>
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-[72px_minmax(0,1fr)_32px] gap-2 rounded-lg border border-border p-2 md:grid-cols-[72px_minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_32px] md:border-0 md:p-0">
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={l.cantidad}
                    onChange={(e) => actualizar(i, { cantidad: Number(e.target.value) })}
                    className="h-9 text-sm tabular-nums"
                    aria-label="Cantidad"
                  />
                  <Select value={l.tipovehiculo} onValueChange={(v) => actualizar(i, { tipovehiculo: v })}>
                    <SelectTrigger className="h-9 text-sm" aria-label="Tipo de vehículo">
                      <SelectValue placeholder="Tipo de vehículo" />
                    </SelectTrigger>
                    <SelectContent>
                      {(cat?.tiposVehiculo ?? []).map((t) => (
                        <SelectItem key={t.nombre} value={t.nombre}>
                          {t.nombre}
                          {t.capacidad ? <span className="ml-1 text-xs text-muted-foreground">· {t.capacidad} t</span> : null}
                        </SelectItem>
                      ))}
                      {l.tipovehiculo && !(cat?.tiposVehiculo ?? []).some((t) => t.nombre === l.tipovehiculo) && (
                        <SelectItem value={l.tipovehiculo}>{l.tipovehiculo}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <button type="button" onClick={() => quitar(i)} className="flex h-9 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive md:order-last" aria-label="Quitar línea">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <Input
                    list="prog-destinos"
                    value={l.destino}
                    onChange={(e) => actualizar(i, { destino: e.target.value })}
                    placeholder="Destino o ruta (Bodega Bogotá, Fundación, Urbano…)"
                    className="col-span-3 h-9 text-sm md:col-span-1"
                  />
                  <Input
                    list="prog-productos"
                    value={l.producto ?? ""}
                    onChange={(e) => actualizar(i, { producto: e.target.value })}
                    placeholder="Producto (opcional)"
                    className="col-span-3 h-9 text-sm md:col-span-1"
                  />
                  <Input
                    value={l.observaciones ?? ""}
                    onChange={(e) => actualizar(i, { observaciones: e.target.value })}
                    placeholder="Observación (opcional)"
                    className="col-span-3 h-9 text-sm md:col-span-1"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={agregar}>
                <Plus className="h-3.5 w-3.5" /> Agregar línea
              </Button>
              <p className="text-xs text-muted-foreground">
                Total: <span className="font-semibold text-foreground tabular-nums">{total}</span> vehículo{total === 1 ? "" : "s"} · hora límite {limite}
              </p>
            </div>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observaciones generales (opcional)" className="mt-2 h-9 text-sm" />
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {vigente && (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => cargarProgramacion()} disabled={guardando}>
                  <X className="h-3.5 w-3.5" /> Cancelar
                </Button>
              )}
              <Button size="sm" className="gap-1.5" onClick={guardar} disabled={guardando || !cat}>
                {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {vigente ? "Guardar nueva versión" : "Enviar programación"}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Cumplimiento (en gerencia va primero) */}
      <section className={cn("lg-card overflow-hidden", modo === "gerencia" && "order-1")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <Eyebrow>Programado vs. llegó a portería · por tipo de vehículo</Eyebrow>
            <h2 className="text-[15px] font-bold leading-tight">Cumplimiento de la programación</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => elegirPreset(p.key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  preset === p.key ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
            <Input
              type="date"
              value={rango.desde}
              onChange={(e) => {
                setPreset("otro")
                setRango((r) => ({ ...r, desde: e.target.value }))
              }}
              className="h-7 w-[132px] text-[11px]"
              aria-label="Desde"
            />
            <Input
              type="date"
              value={rango.hasta}
              onChange={(e) => {
                setPreset("otro")
                setRango((r) => ({ ...r, hasta: e.target.value }))
              }}
              className="h-7 w-[132px] text-[11px]"
              aria-label="Hasta"
            />
          </div>
        </div>

        {errorCump ? (
          <div className="m-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">{errorCump}</div>
        ) : cargandoCump && !cump ? (
          <div className="grid grid-cols-2 gap-6 px-5 py-5 sm:grid-cols-4" aria-busy>
            <Esqueleto lineas={3} />
            <Esqueleto lineas={3} />
            <Esqueleto lineas={3} />
            <Esqueleto lineas={3} />
          </div>
        ) : cump && cump.dias.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Sin programaciones ni vehículos entre {fechaCorta(cump.desde)} y {fechaCorta(cump.hasta)}.
          </div>
        ) : cump ? (
          <>
            <div className="grid grid-cols-2 gap-y-4 border-b border-border px-4 py-4 sm:grid-cols-4 sm:gap-x-6 sm:px-5">
              <Cifra
                tamano="compacta"
                label="Cumplimiento"
                valor={cump.porcentaje == null ? "—" : `${NUM.format(cump.porcentaje)} %`}
                sub={cump.programados > 0 ? `${cump.cumplidos} de ${cump.programados} programados llegaron` : "sin programación en el rango"}
                tono={tonoPct(cump.porcentaje)}
                progreso={cump.porcentaje ?? undefined}
              />
              <Cifra tamano="compacta" label="Llegaron" valor={NUM.format(cump.llegaron)} sub={`${cump.noProgramados} fuera de programación`} />
              <Cifra tamano="compacta" label="No llegaron" valor={NUM.format(cump.noLlegaron)} sub="programados que no se presentaron" tono={cump.noLlegaron > 0 ? "atencion" : "neutro"} />
              <Cifra
                tamano="compacta"
                label="Enviadas a tiempo"
                valor={cump.diasConProgramacion > 0 ? `${cump.diasATiempo}/${cump.diasConProgramacion}` : "—"}
                sub={cump.diasSinProgramacion > 0 ? `${cump.diasSinProgramacion} día${cump.diasSinProgramacion === 1 ? "" : "s"} operado${cump.diasSinProgramacion === 1 ? "" : "s"} sin programación` : "todos los días operados tuvieron programación"}
                tono={cump.diasSinProgramacion > 0 ? "atencion" : "neutro"}
              />
            </div>

            {cump.dias.length > 1 && (
              <div className="h-56 w-full px-2 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={cump.dias.map((d) => ({ dia: fechaCorta(d.fecha), Programados: d.programados, Llegaron: d.llegaron }))} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Programados" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Llegaron" fill="#0f766e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left lg-eyebrow">
                    <th className="px-4 py-2">Día</th>
                    <th className="px-2 py-2">Programación</th>
                    <th className="px-2 py-2 text-right">Prog.</th>
                    <th className="px-2 py-2 text-right">Llegaron</th>
                    <th className="hidden px-2 py-2 text-right sm:table-cell">No llegaron</th>
                    <th className="hidden px-2 py-2 text-right sm:table-cell">Fuera</th>
                    <th className="px-4 py-2 text-right">Cumpl.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[...cump.dias].reverse().map((d) => (
                    <FilaDia key={d.fecha} d={d} abierta={diaAbierto === d.fecha} onToggle={() => setDiaAbierto((x) => (x === d.fecha ? null : d.fecha))} mostrarQuien={!esCliente} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  )
}

function FilaDia({ d, abierta, onToggle, mostrarQuien }: { d: CumplimientoDia; abierta: boolean; onToggle: () => void; mostrarQuien: boolean }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <td className="px-4 py-2 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", abierta && "rotate-180")} />
            {fechaCorta(d.fecha)}
          </span>
        </td>
        <td className="px-2 py-2 text-xs">
          {d.tieneProgramacion ? (
            <span className={cn("inline-flex items-center gap-1", d.aTiempo ? "text-emerald-700" : "text-amber-700")}>
              {d.aTiempo ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
              {d.aTiempo ? "a tiempo" : "tarde"}
              {mostrarQuien && d.enviadaPorUsuario ? <span className="hidden text-muted-foreground md:inline"> · {d.enviadaPorUsuario}</span> : null}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> sin programación
            </span>
          )}
        </td>
        <td className="px-2 py-2 text-right tabular-nums">{d.tieneProgramacion ? d.programados : "—"}</td>
        <td className="px-2 py-2 text-right tabular-nums">{d.llegaron}</td>
        <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{d.tieneProgramacion ? d.noLlegaron : "—"}</td>
        <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{d.noProgramados}</td>
        <td className="px-4 py-2 text-right font-semibold tabular-nums" style={{ color: colorPct(d.porcentaje) }}>
          {d.porcentaje == null ? "—" : `${NUM.format(d.porcentaje)} %`}
        </td>
      </tr>
      {abierta && (
        <tr className="bg-muted/20">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Por tipo de vehículo</p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border">
                    {d.porTipo.map((t) => (
                      <tr key={t.tipovehiculo}>
                        <td className="py-1 pr-2">
                          <span className="inline-flex items-center gap-1">
                            <Truck className="h-3 w-3 text-muted-foreground" /> {t.tipovehiculo}
                          </span>
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{t.programados} prog.</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{t.llegaron} lleg.</td>
                        <td className={cn("py-1 text-right tabular-nums", t.noLlegaron > 0 ? "text-amber-700" : t.noProgramados > 0 ? "text-sky-700" : "text-emerald-700")}>
                          {t.noLlegaron > 0 ? `faltaron ${t.noLlegaron}` : t.noProgramados > 0 ? `+${t.noProgramados} fuera` : "✓"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Líneas programadas</p>
                {d.lineas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">El cliente no envió programación para este día.</p>
                ) : (
                  <ul className="space-y-0.5 text-xs">
                    {d.lineas.map((l, i) => (
                      <li key={i}>
                        <span className="font-semibold tabular-nums">{l.cantidad}</span> {l.tipovehiculo}
                        {l.destino ? ` · ${l.destino}` : ""}
                        {l.producto ? ` · ${l.producto}` : ""}
                        {l.observaciones ? <span className="text-muted-foreground"> · {l.observaciones}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
