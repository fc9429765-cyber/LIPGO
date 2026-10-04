"use client"

// PROGRAMACIÓN DEL PERSONAL — vista de quincena.
//
// Dos pestañas sobre la misma quincena:
//  · Cobertura          — cuánta gente se necesita por puesto y turno vs cuánta hay
//  · Detalle por persona — la grilla persona × día, con el puesto de cada día
//
// Convive con la programación diaria que ya existe: esta vista LEE la quincena
// completa y permite quitar asignaciones; para crear turnos se sigue usando la
// pestaña diaria, que es la que conoce las reglas de inserción.

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Moon,
  Plus,
  Search,
  Users,
} from "lucide-react"
import {
  borrarAsignacion,
  getProgramacionQuincena,
  guardarDemanda,
} from "@/lib/programacion-quincena-actions"
import type {
  CeldaAsignacion,
  DiaQuincena,
  FilaPersona,
  HorarioActividad,
  HorasExtraCelda,
  ProgramacionQuincenaData,
} from "@/lib/programacion-quincena-tipos"

const NUM = new Intl.NumberFormat("es-CO")

/**
 * Color por PUESTO para la grilla.
 *
 * Se asigna por posición dentro de la lista ordenada de puestos del periodo,
 * no al azar: así el mismo puesto conserva su color entre recargas y entre
 * quincenas, que es lo que permite leer la grilla de un vistazo.
 */
// Paleta validada con node scripts/validate_palette.js (skill dataviz),
// --pairs all (cualquier par debe distinguirse, no solo los vecinos): las
// primeras 8 pasan TODOS los chequeos (banda de luminosidad, piso de croma,
// separación bajo daltonismo protan/deutan >=8 y a simple vista >=15); de la
// 9 en adelante ya no es matemáticamente posible seguir pasando el piso de
// daltonismo con 15 colores en total (confirmado por búsqueda numérica), así
// que quedan lo mejor posible -- por eso la leyenda y el tooltip de cada
// celda siempre muestran el nombre real del puesto además del color.
const PALETA_PUESTOS = [
  "#bb15b8", "#7a3b76", "#9f7bf8", "#4a59eb", "#c48118", "#d13218", "#cd6b9e", "#2c9068",
  "#415c9c", "#301ae2", "#6f12a7", "#94004a", "#f31662", "#dd4ed0", "#954241",
]

function colorDePuesto(puesto: string | null, orden: string[]): string {
  if (!puesto) return "#94a3b8"
  const i = orden.indexOf(puesto)
  return i >= 0 ? PALETA_PUESTOS[i % PALETA_PUESTOS.length] : "#64748b"
}

const STOPWORDS_SIGLA = new Set(["de", "del", "la", "el", "los", "las", "y", "en", "por", "con", "a"])

/**
 * Sigla corta (2 letras) por puesto, única dentro de la lista de la quincena.
 * Va DENTRO de cada celda junto a la hora: con 9+ puestos simultáneos ya no
 * existen colores perfectamente separables para daltonismo (ver nota de
 * PALETA_PUESTOS), así que la sigla es la segunda pista que quita la duda.
 */
function siglasDePuestos(puestos: string[]): Record<string, string> {
  const usadas = new Set<string>()
  const out: Record<string, string> = {}
  for (const p of puestos) {
    const w = p.split(/[\s/]+/).filter((x) => x && !STOPWORDS_SIGLA.has(x.toLowerCase()))
    const cand: string[] = []
    if (w.length >= 2) cand.push((w[0][0] + w[1][0]).toUpperCase())
    if (w.length >= 3) cand.push((w[0][0] + w[2][0]).toUpperCase())
    if (w.length >= 3) cand.push((w[1][0] + w[2][0]).toUpperCase())
    if (w.length >= 1) cand.push(w[0].slice(0, 2).toUpperCase())
    let sigla = cand.find((c) => c.length > 0 && !usadas.has(c))
    if (!sigla) {
      const base = (w[0]?.[0] ?? "?").toUpperCase()
      let n = 2
      while (usadas.has(base + n)) n++
      sigla = base + n
    }
    usadas.add(sigla)
    out[p] = sigla
  }
  return out
}

/** Celda elegida en la grilla de Detalle: alimenta el popover de detalle/quitar. */
interface CeldaSeleccionada {
  id: number | null
  nombre: string
  fecha: string
  diaLabel: string
  puesto: string | null
  horaEntrada: string | null
  horaSalida: string | null
  marco: boolean
  horasExtra: HorasExtraCelda | null
  x: number
  y: number
}

/** Texto + color del renglón "Horas extra" del popover, ya resuelto. */
function estadoHorasExtra(h: HorasExtraCelda | null): { texto: string; clase: string } {
  if (!h || !h.aplica) {
    return { texto: "No aplica — puesto al destajo, paga por tonelada", clase: "text-muted-foreground" }
  }
  if (!h.cerrado) {
    return { texto: "Turno en curso — aún no marca salida", clase: "text-muted-foreground" }
  }
  const total = Math.round((h.ordinaria + h.festiva) * 100) / 100
  if (total <= 0) {
    return { texto: "No generó horas extra", clase: "text-muted-foreground" }
  }
  const partes: string[] = []
  if (h.ordinaria > 0) partes.push(`${h.ordinaria} h ordinaria`)
  if (h.festiva > 0) partes.push(`${h.festiva} h dominical/festiva`)
  return { texto: `${total} h extra (${partes.join(" + ")})`, clase: "font-medium text-amber-700" }
}

function hoyColombia(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  const [a, m, d] = s.split("-").map(Number)
  return new Date(a, m - 1, d)
}

/** Ficha de un horario REAL en uso (puesto + horaInicio-horaFin), no un turno fijo. */
function FichaHorario({ h, color }: { h: HorarioActividad; color: string }) {
  return (
    <div className="min-w-[210px] flex-1 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
          <span className="text-sm font-medium">{h.puesto}</span>
        </div>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">{h.horas} h</span>
      </div>
      <p className="mt-1.5 font-mono text-xs text-muted-foreground">
        {h.horaInicio} — {h.horaFin}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          usado {h.muestras} {h.muestras === 1 ? "vez" : "veces"} esta quincena
        </span>
        {h.horasNocturnas > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700"
            title="Estimado de pantalla. El sistema todavía no liquida el recargo nocturno."
          >
            <Moon className="h-3 w-3" />
            {h.horasNocturnas} h en franja nocturna
          </span>
        )}
      </div>
    </div>
  )
}

export function ProgramacionQuincena() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const inicial = hoyColombia()
  const [anio, setAnio] = useState(inicial.getFullYear())
  const [mes, setMes] = useState(inicial.getMonth() + 1)
  const [quincena, setQuincena] = useState<1 | 2>(inicial.getDate() <= 15 ? 1 : 2)

  const [data, setData] = useState<ProgramacionQuincenaData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [buscar, setBuscar] = useState("")
  const [equipoFiltro, setEquipoFiltro] = useState<number | null>(null)
  const [editDemanda, setEditDemanda] = useState<{ puesto: string; horaInicio: string; valor: string } | null>(null)
  // Alta de demanda para un puesto que todavia no tiene fila.
  const [nuevaDemanda, setNuevaDemanda] = useState<{ puesto: string; horaInicio: string; valor: string } | null>(null)

  // --- Interacción de la grilla "Detalle por persona" (solo capa visual) ---
  /** Puesto resaltado desde la leyenda: el resto de celdas se atenúa. */
  const [puestoResaltado, setPuestoResaltado] = useState<string | null>(null)
  /** Columna (fecha) bajo el mouse, para la guía en cruz. */
  const [hovCol, setHovCol] = useState<string | null>(null)
  /** Celda con el popover de detalle abierto. Quitar pasa por aquí, ya no por un clic directo. */
  const [celdaSel, setCeldaSel] = useState<CeldaSeleccionada | null>(null)
  const [quitando, setQuitando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await getProgramacionQuincena(selectedEmpresaId ?? null, anio, mes, quincena)
    if (r.success && r.data) setData(r.data)
    else {
      setData(null)
      setError(r.message ?? "No se pudo cargar la programación.")
    }
    setCargando(false)
  }, [selectedEmpresaId, anio, mes, quincena])

  useEffect(() => {
    cargar()
  }, [cargar])

  function mover(delta: number) {
    let q = quincena === 1 ? 2 : 1
    let m = mes
    let a = anio
    if (delta > 0 && quincena === 2) { m = mes === 12 ? 1 : mes + 1; if (mes === 12) a = anio + 1 }
    if (delta < 0 && quincena === 1) { m = mes === 1 ? 12 : mes - 1; if (mes === 1) a = anio - 1 }
    setQuincena(q as 1 | 2); setMes(m); setAnio(a)
  }

  // Puestos que realmente aparecen en la quincena. Es la leyenda: solo se
  // listan los que se usaron, no todo el catálogo.
  const puestosEnUso = useMemo(() => {
    if (!data) return []
    const s = new Set<string>()
    for (const p of data.personas) {
      for (const c of Object.values(p.dias)) {
        if (c.puesto && !c.novedad) s.add(c.puesto)
      }
    }
    return [...s].sort((a, b) => a.localeCompare(b, "es"))
  }, [data])

  const siglas = useMemo(() => siglasDePuestos(puestosEnUso), [puestosEnUso])

  const personasFiltradas = useMemo(() => {
    if (!data) return []
    const t = buscar.trim().toLowerCase()
    return data.personas.filter((p) => {
      if (equipoFiltro != null && p.equipoId !== equipoFiltro) return false
      return !t || p.nombre.toLowerCase().includes(t) || p.identificacion.includes(t)
    })
  }, [data, buscar, equipoFiltro])

  // Personas programadas por día (respeta búsqueda y filtro de equipo):
  // alimenta la fila "Personas / día" al pie de la grilla de Detalle.
  const totalesPorDia = useMemo(() => {
    const m: Record<string, number> = {}
    if (!data) return m
    for (const dd of data.dias) {
      let n = 0
      for (const per of personasFiltradas) {
        const c = per.dias[dd.fecha]
        if (c && !c.novedad && c.puesto) n++
      }
      m[dd.fecha] = n
    }
    return m
  }, [data, personasFiltradas])

  /** Promedio de los días que sí tienen gente: sirve para marcar días flacos. */
  const mediaPersonasDia = useMemo(() => {
    const vals = Object.values(totalesPorDia).filter((n) => n > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
  }, [totalesPorDia])

  // Al cambiar de quincena/empresa, el resaltado y el popover pierden sentido.
  useEffect(() => {
    setPuestoResaltado(null)
    setCeldaSel(null)
  }, [data])

  useEffect(() => {
    if (!celdaSel) return
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCeldaSel(null)
    }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [celdaSel])

  async function quitar(id: number, nombre: string, fecha: string) {
    if (!selectedEmpresaId) return
    const r = await borrarAsignacion(selectedEmpresaId, id)
    if (!r.success) {
      toast({ title: "No se pudo quitar", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: "Asignación retirada", description: `${nombre} · ${fecha}` })
    cargar()
  }

  /** Abre el popover de detalle de la celda, pegado al botón que se clicó. */
  function abrirDetalle(
    e: ReactMouseEvent<HTMLButtonElement>,
    per: FilaPersona,
    dd: DiaQuincena,
    c: CeldaAsignacion,
  ) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.min(Math.max(8, r.left + r.width / 2 - 130), window.innerWidth - 268)
    let y = r.bottom + 8
    if (y + 260 > window.innerHeight) y = Math.max(8, r.top - 268)
    setCeldaSel({
      id: c.id,
      nombre: per.nombre,
      fecha: dd.fecha,
      diaLabel: `${dd.diaSemana} ${dd.diaMes}`,
      puesto: c.puesto,
      horaEntrada: c.horaEntrada,
      horaSalida: c.horaSalida,
      marco: c.marco,
      horasExtra: c.horasExtra,
      x,
      y,
    })
  }

  async function guardarReq(
    d: { puesto: string; horaInicio: string; valor: string } | null,
    esNueva = false,
  ) {
    if (!d || !selectedEmpresaId) return
    if (!d.puesto || !d.horaInicio) {
      toast({ title: "Falta el puesto o la hora de entrada", variant: "destructive" })
      return
    }
    const r = await guardarDemanda({
      empresaId: selectedEmpresaId,
      puesto: d.puesto,
      horaInicio: d.horaInicio,
      requeridos: Number(d.valor) || 0,
    })
    if (!r.success) {
      toast({ title: "No se pudo guardar", description: r.message, variant: "destructive" })
      return
    }
    toast({
      title: "Demanda guardada",
      description: `${d.puesto} · entra ${d.horaInicio}: ${Number(d.valor) || 0} persona(s) por día.`,
    })
    if (esNueva) setNuevaDemanda(null)
    else setEditDemanda(null)
    cargar()
  }

  if (cargando) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        </div>
      </div>
    )
  }

  const d = data

  return (
    <div className="space-y-4 p-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="lg-eyebrow">Turnos</p>
          <h1 className="text-xl font-semibold">Programación del personal</h1>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border px-1 py-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => mover(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-2 text-center">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Quincena</p>
            <p className="text-sm font-medium">
              {d.quincena.etiqueta} {d.quincena.anio}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => mover(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Falta el script: se dice, no se muestra una grilla vacía */}
      {d.faltaMigracion && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Falta correr <code className="font-mono text-xs">scripts/176_add_programacion_turnos_quincena.sql</code>
          </p>
          <p className="mt-1 text-xs">
            Sin él no existen los equipos ni la demanda por puesto (Cobertura). Los horarios reales
            y el Detalle por persona funcionan igual, esos no dependen de esta migración.
          </p>
        </div>
      )}

      {d.avisos.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {d.avisos.map((a) => (
            <p key={a} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {a}
            </p>
          ))}
        </div>
      )}

      {/* HORARIOS REALES EN USO — se calculan solos de lo que el coordinador
          programó en "Programar el día", no de una tabla de configuración
          fija (que se desactualizaba en cuanto los horarios cambiaban). */}
      <section className="lg-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Horarios reales en uso esta quincena</h2>
            <p className="text-xs text-muted-foreground">
              Se arman solos a partir de lo que ya se programó — no es una configuración fija.
            </p>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">
            Franja nocturna 19:00–06:00
          </span>
        </div>

        {d.horariosReales.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Todavía no hay nada programado esta quincena. En cuanto el coordinador programe en
            "Programar el día", los horarios reales aparecen aquí solos.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {d.horariosReales.map((h) => (
              <FichaHorario
                key={`${h.puesto}|${h.horaInicio}|${h.horaFin}`}
                h={h}
                color={colorDePuesto(h.puesto, puestosEnUso)}
              />
            ))}
          </div>
        )}

        {/* Lo que el sistema NO calcula todavía. Se dice aquí y no se simula. */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <p className="flex items-start gap-1.5 text-[11px] text-slate-700">
            <Moon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Las <strong>{d.totales.horasNocturnasEstimadas} h</strong> en franja nocturna de esta
              quincena son un <strong>estimado de esta pantalla</strong>. El recargo nocturno
              todavía no se liquida: la nómina calcula horas extra diurnas y festivas, y las
              columnas de recargo nocturno siguen en cero. Mientras eso siga así, aquí no se
              muestra un valor en pesos que la nómina no respalda.
            </span>
          </p>
        </div>
      </section>

      <Tabs defaultValue="cobertura">
        <TabsList>
          <TabsTrigger value="cobertura">Cobertura</TabsTrigger>
          <TabsTrigger value="detalle">Detalle por persona</TabsTrigger>
        </TabsList>

        {/* ---------------- COBERTURA ---------------- */}
        <TabsContent value="cobertura" className="pt-3">
          <section className="lg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Demanda por puesto</h2>
                <p className="text-xs text-muted-foreground">
                  Declara cuántas personas necesitas en cada puesto, entrando a una hora concreta.
                  Cada celda de abajo compara eso contra cuántas quedaron programadas ese día.
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() =>
                    setNuevaDemanda({
                      puesto: d.puestos[0] ?? "",
                      horaInicio: d.horariosReales[0]?.horaInicio ?? "06:00",
                      valor: "0",
                    })
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Definir puesto
                </Button>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> cubierto
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" /> parcial
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> déficit
                </span>
              </div>
            </div>

            {/* Alta de demanda: cuánta gente se necesita en un puesto,
                entrando a una hora concreta. Los puestos salen de
                `tarifasturnos`, el MISMO catálogo con el que se programa: así
                lo que se exige coincide siempre con lo que se puede asignar. */}
            {nuevaDemanda && (
              <div className="flex flex-wrap items-end gap-2 border-b border-border bg-muted/30 px-4 py-3">
                <div>
                  <label className="block text-[11px] text-muted-foreground">Puesto</label>
                  <select
                    value={nuevaDemanda.puesto}
                    onChange={(e) => setNuevaDemanda({ ...nuevaDemanda, puesto: e.target.value })}
                    className="mt-1 h-8 w-56 rounded border bg-background px-2 text-xs"
                  >
                    {d.puestos.length === 0 && <option value="">Sin puestos en el catálogo</option>}
                    {d.puestos.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground">Hora de entrada</label>
                  <Input
                    type="time"
                    value={nuevaDemanda.horaInicio}
                    onChange={(e) => setNuevaDemanda({ ...nuevaDemanda, horaInicio: e.target.value })}
                    className="mt-1 h-8 w-32 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-muted-foreground">Personas por día</label>
                  <Input
                    type="number"
                    min={0}
                    value={nuevaDemanda.valor}
                    onChange={(e) => setNuevaDemanda({ ...nuevaDemanda, valor: e.target.value })}
                    className="mt-1 h-8 w-24 text-sm"
                  />
                </div>
                <Button size="sm" onClick={() => guardarReq(nuevaDemanda, true)}>
                  Guardar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNuevaDemanda(null)}>
                  Cancelar
                </Button>
                <p className="w-full text-[11px] text-muted-foreground">
                  Aplica a todos los días de la quincena. Para cambiar un día puntual, edítalo
                  desde su celda.
                </p>
              </div>
            )}

            {d.cobertura.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Todavía no has definido cuánta gente requiere cada puesto.
                </p>
                <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
                  Esa información no existe hoy en el sistema: no se puede deducir de lo programado,
                  porque lo programado es lo que hubo, no lo que se necesitaba. Defínela una vez con
                  "Definir puesto" (arriba) y la cobertura se calcula sola cada quincena — cada celda
                  compara cuántos quedaron programados ese día contra cuántos declaraste que hacen falta.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">
                        Puesto · hora de entrada
                      </th>
                      {d.dias.map((dd) => (
                        <th
                          key={dd.fecha}
                          className={`px-1 py-2 text-center font-medium ${dd.esFestivo ? "bg-amber-50" : dd.esDomingo ? "bg-muted/50" : ""}`}
                        >
                          <span className="block text-[10px] text-muted-foreground">{dd.diaSemana}</span>
                          <span className="block">{dd.diaMes}</span>
                          {dd.esFestivo && (
                            <span className="block text-[8px] uppercase text-amber-700">festivo</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.cobertura.map((f) => (
                      <tr key={`${f.puesto}|${f.horaInicio}`} className="border-b border-border last:border-0">
                        <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                          <span className="flex items-center gap-1.5">
                            <span className="rounded bg-muted px-1 font-mono text-[10px]">
                              {f.horaInicio}
                            </span>
                            <span className="font-medium">{f.puesto}</span>
                          </span>
                          <button
                            type="button"
                            className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                            onClick={() =>
                              setEditDemanda({
                                puesto: f.puesto,
                                horaInicio: f.horaInicio,
                                valor: String(f.requeridosBase),
                              })
                            }
                          >
                            requiere {f.requeridosBase} · cambiar
                          </button>
                        </td>
                        {f.dias.map((c) => (
                          <td key={c.fecha} className="px-1 py-1.5 text-center">
                            <span
                              className="inline-block rounded px-1 py-0.5 font-mono text-[10px] tabular-nums"
                              title={`${c.asignados} programada(s) de las ${c.requeridos} que este puesto necesita ese día`}
                              style={{
                                background:
                                  c.estado === "cubierto" ? "#dcfce7"
                                  : c.estado === "parcial" ? "#fef3c7"
                                  : c.estado === "deficit" ? "#fee2e2" : "transparent",
                                color:
                                  c.estado === "cubierto" ? "#166534"
                                  : c.estado === "parcial" ? "#92400e"
                                  : c.estado === "deficit" ? "#991b1b" : "inherit",
                              }}
                            >
                              {c.asignados}/{c.requeridos}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {editDemanda && (
              <div className="flex flex-wrap items-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
                <div>
                  <label className="block text-[11px] text-muted-foreground">
                    {editDemanda.puesto} · entra {editDemanda.horaInicio}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={editDemanda.valor}
                    onChange={(e) => setEditDemanda({ ...editDemanda, valor: e.target.value })}
                    className="mt-1 h-8 w-28 text-sm"
                  />
                </div>
                <Button size="sm" onClick={() => guardarReq(editDemanda)}>Guardar</Button>
                <Button size="sm" variant="outline" onClick={() => setEditDemanda(null)}>
                  Cancelar
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Aplica a todos los días de la quincena.
                </p>
              </div>
            )}
          </section>
        </TabsContent>

        {/* ---------------- EQUIPOS Y PATRONES ---------------- */}
        <TabsContent value="detalle" className="pt-3">
          <section className="lg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Detalle por persona</h2>
                <p className="text-xs text-muted-foreground">
                  {NUM.format(personasFiltradas.length)} de {NUM.format(d.totales.personas)} personas ·{" "}
                  {NUM.format(d.totales.diasProgramados)} turnos ·{" "}
                  {NUM.format(d.totales.horasProgramadas)} h programadas
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.equipos.length > 0 && (
                  <select
                    value={equipoFiltro ?? ""}
                    onChange={(e) => setEquipoFiltro(e.target.value ? Number(e.target.value) : null)}
                    className="h-8 rounded border bg-background px-2 text-xs"
                  >
                    <option value="">Todos los equipos</option>
                    {d.equipos.map((e) => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                )}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar persona…"
                    value={buscar}
                    onChange={(e) => setBuscar(e.target.value)}
                    className="h-8 w-48 pl-7 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Leyenda de puestos: cada color+sigla de la grilla dice en qué
                puesto estuvo la persona ese día. Clic en un puesto lo resalta
                en toda la grilla (clic de nuevo, vuelve a la normalidad). */}
            {puestosEnUso.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-4 py-2.5">
                <span className="text-[11px] text-muted-foreground">Puesto:</span>
                {puestosEnUso.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPuestoResaltado(puestoResaltado === p ? null : p)}
                    title={puestoResaltado === p ? "Quitar resaltado" : `Resaltar solo ${p} en la grilla`}
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-opacity ${
                      puestoResaltado === p
                        ? "border-foreground font-semibold"
                        : "border-transparent hover:border-border"
                    } ${puestoResaltado !== null && puestoResaltado !== p ? "opacity-40" : ""}`}
                  >
                    <span
                      className="inline-flex h-4 min-w-[22px] items-center justify-center rounded px-1 text-[9px] font-bold text-white"
                      style={{ background: colorDePuesto(p, puestosEnUso) }}
                    >
                      {siglas[p]}
                    </span>
                    {p}
                  </button>
                ))}
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />
                  novedad
                </span>
                <span className="ml-auto text-[10.5px] text-muted-foreground">
                  clic en un puesto para resaltarlo · <b>punto blanco</b> = ya marcó ingreso
                </span>
              </div>
            )}

            {personasFiltradas.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No hay personas que coincidan.
              </p>
            ) : (
              <div className="max-h-[560px] overflow-auto">
                <table className="w-full border-collapse text-xs" onMouseLeave={() => setHovCol(null)}>
                  <thead className="sticky top-0 z-20 bg-card">
                    <tr className="border-b border-border">
                      <th
                        className="sticky left-0 z-30 bg-card px-3 py-2 text-left font-medium"
                        onMouseEnter={() => setHovCol(null)}
                      >
                        Trabajador
                      </th>
                      {d.dias.map((dd) => (
                        <th
                          key={dd.fecha}
                          onMouseEnter={() => setHovCol(dd.fecha)}
                          className={`min-w-[44px] px-1 py-2 text-center font-medium ${hovCol === dd.fecha ? "bg-[#e8eef6]" : dd.esFestivo ? "bg-amber-50" : dd.esDomingo ? "bg-muted/50" : ""}`}
                        >
                          <span className="block text-[10px] text-muted-foreground">{dd.diaSemana}</span>
                          <span className="block">{dd.diaMes}</span>
                        </th>
                      ))}
                      <th className="px-2 py-2 text-right font-medium" onMouseEnter={() => setHovCol(null)}>
                        Horas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {personasFiltradas.map((per) => (
                      <tr key={per.identificacion} className="group border-b border-border last:border-0">
                        <td
                          className="sticky left-0 z-10 bg-card px-3 py-1.5 group-hover:bg-[#e8eef6]"
                          onMouseEnter={() => setHovCol(null)}
                        >
                          <p className="max-w-[220px] truncate font-medium">{per.nombre}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {per.identificacion}
                            {per.equipoNombre ? ` · ${per.equipoNombre}` : ""}
                          </p>
                        </td>
                        {d.dias.map((dd) => {
                          const c = per.dias[dd.fecha]
                          const atenuada = puestoResaltado !== null && (!c || c.puesto !== puestoResaltado)
                          return (
                            <td
                              key={dd.fecha}
                              onMouseEnter={() => setHovCol(dd.fecha)}
                              className={`px-0.5 py-1 text-center group-hover:bg-[#e8eef6] ${hovCol === dd.fecha ? "bg-[#e8eef6]" : dd.esFestivo ? "bg-amber-50/50" : dd.esDomingo ? "bg-muted/30" : ""}`}
                            >
                              {!c ? (
                                <span className="text-muted-foreground/40">·</span>
                              ) : c.novedad ? (
                                <span
                                  title={c.novedad}
                                  className={`inline-block max-w-[38px] truncate rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600 ${atenuada ? "opacity-[0.15]" : ""}`}
                                >
                                  {c.novedad.replace(/^\d+-\s*/, "").slice(0, 4)}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  title={`${c.puesto ?? ""} ${c.horaEntrada ?? ""}-${c.horaSalida ?? ""}${c.marco ? " · ya marcó" : ""} — clic para ver el detalle`}
                                  onClick={(e) => abrirDetalle(e, per, dd, c)}
                                  className={`inline-flex items-center gap-[3px] rounded px-1 py-0.5 font-mono text-[10px] font-semibold text-white transition-opacity hover:opacity-85 ${atenuada ? "opacity-[0.15]" : ""}`}
                                  // El color y la sigla los da el PUESTO: es lo
                                  // que se quiere leer de un vistazo en la
                                  // grilla --dónde estuvo cada quien-- y la
                                  // hora de entrada completa el código.
                                  style={{ background: colorDePuesto(c.puesto, puestosEnUso) }}
                                >
                                  {c.puesto ? (siglas[c.puesto] ?? "?") : "?"}·
                                  {c.horaEntrada ? c.horaEntrada.slice(0, 2) : "?"}
                                  {c.marco && (
                                    <span
                                      className="h-1 w-1 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
                                      aria-label="ya marcó ingreso"
                                    />
                                  )}
                                </button>
                              )}
                            </td>
                          )
                        })}
                        <td
                          className="px-2 py-1.5 text-right group-hover:bg-[#e8eef6]"
                          onMouseEnter={() => setHovCol(null)}
                        >
                          <span className="font-medium tabular-nums">{per.horasQuincena} h</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {per.diasConTurno} {per.diasConTurno === 1 ? "turno" : "turnos"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Personas programadas por día: la cobertura de un vistazo
                      sin salir de la pestaña. Ámbar = día flaco frente al
                      promedio de la quincena. */}
                  <tfoot>
                    <tr>
                      <th
                        className="sticky bottom-0 left-0 z-30 border-t border-border bg-card px-3 py-2 text-left lg-eyebrow"
                        onMouseEnter={() => setHovCol(null)}
                      >
                        Personas / día
                      </th>
                      {d.dias.map((dd) => {
                        const t = totalesPorDia[dd.fecha] ?? 0
                        const bajo = t > 0 && mediaPersonasDia > 0 && t < mediaPersonasDia * 0.75
                        return (
                          <th
                            key={dd.fecha}
                            onMouseEnter={() => setHovCol(dd.fecha)}
                            title={bajo ? `Cobertura baja: ${t} frente a un promedio de ${Math.round(mediaPersonasDia)} por día` : undefined}
                            className={`sticky bottom-0 z-20 border-t border-border px-1 py-2 text-center font-semibold tabular-nums ${
                              bajo ? "bg-amber-100 text-amber-800" : hovCol === dd.fecha ? "bg-[#e8eef6]" : "bg-card"
                            }`}
                          >
                            {t === 0 ? <span className="font-normal text-muted-foreground/50">0</span> : t}
                          </th>
                        )
                      })}
                      <th
                        className="sticky bottom-0 z-20 border-t border-border bg-card px-2 py-2 text-right font-normal text-muted-foreground"
                        onMouseEnter={() => setHovCol(null)}
                      >
                        —
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="border-t border-border px-4 py-2.5">
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Clic en un turno abre su detalle; desde ahí se quita con un botón explícito — ya
                  nada se borra por un clic accidental. <strong>No hay borrador</strong>: lo que se ve
                  aquí ya está en nómina y facturación. Para asignar turnos usa la pestaña de
                  programación diaria, que aplica las reglas de inserción.
                </span>
              </p>
            </div>
          </section>
        </TabsContent>
      </Tabs>

      {/* Popover de detalle de una celda de la grilla. Quitar la asignación
          pasa por aquí --botón explícito-- en vez del clic directo de antes,
          que borraba de una sobre datos que ya están en nómina. */}
      {celdaSel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setCeldaSel(null)} />
          <div
            role="dialog"
            aria-label={`Detalle del turno de ${celdaSel.nombre}`}
            className="fixed z-50 w-[260px] lg-card p-3 shadow-2xl"
            style={{ left: celdaSel.x, top: celdaSel.y }}
          >
            <p className="text-sm font-semibold leading-tight">{celdaSel.nombre}</p>
            <p className="text-[11px] text-muted-foreground">
              {celdaSel.diaLabel} · {celdaSel.fecha}
            </p>
            <div className="mt-2 space-y-1.5 text-xs">
              <p className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] text-muted-foreground">Puesto</span>
                {celdaSel.puesto ? (
                  <>
                    <span
                      className="inline-flex h-4 min-w-[22px] items-center justify-center rounded px-1 text-[9px] font-bold text-white"
                      style={{ background: colorDePuesto(celdaSel.puesto, puestosEnUso) }}
                    >
                      {siglas[celdaSel.puesto] ?? "?"}
                    </span>
                    <span className="font-medium">{celdaSel.puesto}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              <p className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] text-muted-foreground">Horario</span>
                <span className="font-mono">
                  {celdaSel.horaEntrada ?? "?"} – {celdaSel.horaSalida ?? "?"}
                </span>
              </p>
              <p className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] text-muted-foreground">Estado</span>
                {celdaSel.marco ? (
                  <span className="font-medium text-emerald-700">✓ Ya marcó ingreso</span>
                ) : (
                  <span className="text-muted-foreground">Programado — aún no marca</span>
                )}
              </p>
              <p className="flex items-start gap-2">
                <span className="w-14 shrink-0 pt-px text-[10px] text-muted-foreground">Extra</span>
                <span className={estadoHorasExtra(celdaSel.horasExtra).clase}>
                  {estadoHorasExtra(celdaSel.horasExtra).texto}
                </span>
              </p>
            </div>
            <div className="mt-3 flex gap-2 border-t border-border pt-2.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 border-red-200 bg-red-50 text-xs text-red-700 hover:bg-red-100 hover:text-red-800"
                disabled={quitando || !celdaSel.id}
                onClick={async () => {
                  if (!celdaSel.id) return
                  setQuitando(true)
                  await quitar(celdaSel.id, celdaSel.nombre, celdaSel.fecha)
                  setQuitando(false)
                  setCeldaSel(null)
                }}
              >
                {quitando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Quitar asignación
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 flex-1 text-xs"
                onClick={() => setCeldaSel(null)}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ProgramacionQuincena
