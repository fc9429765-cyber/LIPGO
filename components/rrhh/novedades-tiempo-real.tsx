"use client"

// NOVEDADES DE PERSONAL — reportar y ver el efecto en la quincena.
//
// Dos columnas: a la izquierda el formulario de registro, a la derecha las
// novedades del periodo con su impacto en nómina.
//
// El registro usa `registrarNovedad`, que resuelve la fila (update-or-insert por
// fecha) y REUSA los efectos colaterales que ya existían: procesar el retiro e
// iniciar el borrador de ausentismo SST. No se llama a /api/personnel-notices
// porque ese endpoint espera filas que ya existen --hace .eq("id", record.id)--
// y con una persona sin fila ese día la novedad se perdería sin avisar.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { supabase } from "@/lib/supabase"
import { leerPersonalBasico } from "@/lib/finanzas-lectura-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Radio,
  Search,
} from "lucide-react"
import { getNovedadesPeriodo, registrarNovedad } from "@/lib/novedades-periodo-actions"
import { NOVEDADES_META } from "@/lib/novedades-catalogo"
import type { NovedadPeriodo, NovedadesPeriodoData } from "@/lib/novedades-periodo-tipos"

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})
const NUM = new Intl.NumberFormat("es-CO")

function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

type Filtro = "todas" | "descuentan" | "medicas" | "arl"

interface Persona {
  identificacion: string
  nombre: string
  cargo: string | null
}

export default function NovedadesTiempoReal() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const hoy = hoyColombia()
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)))
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)))
  const [quincena, setQuincena] = useState<1 | 2>(Number(hoy.slice(8, 10)) <= 15 ? 1 : 2)

  const [data, setData] = useState<NovedadesPeriodoData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("todas")
  const [enVivo, setEnVivo] = useState(false)

  // Formulario
  const [personas, setPersonas] = useState<Persona[]>([])
  const [buscarPersona, setBuscarPersona] = useState("")
  const [persona, setPersona] = useState<Persona | null>(null)
  const [novedad, setNovedad] = useState<string>(NOVEDADES_META[0]?.valor ?? "")
  const [fechaDesde, setFechaDesde] = useState(hoy)
  const [fechaHasta, setFechaHasta] = useState("")
  const [observacion, setObservacion] = useState("")
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await getNovedadesPeriodo(selectedEmpresaId ?? null, anio, mes, quincena)
    if (r.success && r.data) setData(r.data)
    else {
      setData(null)
      setError(r.message ?? "No se pudieron cargar las novedades.")
    }
    setCargando(false)
  }, [selectedEmpresaId, anio, mes, quincena])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Personal activo para el selector.
  useEffect(() => {
    if (!selectedEmpresaId) return
    let vivo = true
    // Vía servidor (SEGURIDAD 2026-10-03): solo identificación, nombre y cargo, activos.
    leerPersonalBasico(selectedEmpresaId, true)
      .then((d) => {
        if (!vivo) return
        setPersonas(
          d
            .filter((r) => !/prueba/i.test(String(r.nombre ?? "")))
            .map((r) => ({ identificacion: r.identificacion, nombre: r.nombre ?? "", cargo: r.cargo ?? null })),
        )
      })
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [selectedEmpresaId])

  // Tiempo real: cualquier cambio en registroasistencia recarga el periodo.
  // Mismo patrón que el visor de asistencia diario; el canal debe ser propio
  // para no chocar con el suyo.
  useEffect(() => {
    const canal = supabase
      .channel("novedades-personal-periodo")
      .on("postgres_changes", { event: "*", schema: "public", table: "registroasistencia" }, () => {
        cargar()
      })
      .subscribe((estado: string) => setEnVivo(estado === "SUBSCRIBED"))
    return () => {
      supabase.removeChannel(canal)
    }
  }, [cargar])

  function mover(delta: number) {
    const q = quincena === 1 ? 2 : 1
    let m = mes
    let a = anio
    if (delta > 0 && quincena === 2) { m = mes === 12 ? 1 : mes + 1; if (mes === 12) a = anio + 1 }
    if (delta < 0 && quincena === 1) { m = mes === 1 ? 12 : mes - 1; if (mes === 1) a = anio - 1 }
    setQuincena(q as 1 | 2); setMes(m); setAnio(a)
  }

  const metaSel = NOVEDADES_META.find((m) => m.valor === novedad)

  const personasFiltradas = useMemo(() => {
    const t = buscarPersona.trim().toLowerCase()
    if (!t) return personas.slice(0, 50)
    return personas
      .filter((p) => p.nombre.toLowerCase().includes(t) || p.identificacion.includes(t))
      .slice(0, 50)
  }, [personas, buscarPersona])

  const visibles = useMemo(() => {
    if (!data) return []
    return data.novedades.filter((n) => {
      if (filtro === "descuentan") return !n.pagaElDia
      if (filtro === "medicas") return n.categoria === "ENFERMEDAD_GENERAL" || n.categoria === "ACCIDENTE_LABORAL"
      if (filtro === "arl") return n.estado === "en_tramite_arl"
      return true
    })
  }, [data, filtro])

  async function registrar() {
    if (!persona || !novedad || !selectedEmpresaId) return
    setGuardando(true)
    try {
      const r = await registrarNovedad({
        empresaId: selectedEmpresaId,
        identificacion: persona.identificacion,
        nombre: persona.nombre,
        valor: novedad,
        fechaDesde,
        fechaHasta: fechaHasta || null,
      })
      if (!r.success) {
        toast({ title: "No se pudo registrar", description: r.message, variant: "destructive" })
        return
      }
      toast({
        title: r.dias && r.dias > 1 ? `Novedad registrada (${r.dias} días)` : "Novedad registrada",
        description: `${persona.nombre} · ${metaSel?.etiqueta ?? novedad}`,
      })
      setPersona(null)
      setBuscarPersona("")
      setObservacion("")
      setFechaHasta("")
      cargar()
    } catch (e: any) {
      toast({ title: "No se pudo registrar", description: e?.message, variant: "destructive" })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="lg-eyebrow">Novedades</p>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            Novedades de personal
            {enVivo && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-normal text-emerald-700">
                <Radio className="h-3 w-3" />
                en vivo
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border px-1 py-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => mover(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="px-2 text-center">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Quincena</p>
            <p className="text-sm font-medium">
              {data ? `${data.quincena.etiqueta} ${data.quincena.anio}` : "—"}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => mover(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {data?.avisos?.length ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          {data.avisos.map((a) => (
            <p key={a} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {a}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,400px)_1fr]">
        {/* ---------------- REPORTAR ---------------- */}
        <section className="h-fit lg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Reportar novedad</h2>
          </div>
          <div className="space-y-3 p-4">
            <div>
              <Label className="text-xs">Trabajador</Label>
              {persona ? (
                <div className="mt-1 flex items-center gap-2 rounded border border-border px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {persona.nombre}
                    {persona.cargo ? ` · ${persona.cargo}` : ""}
                  </span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setPersona(null)}>
                    cambiar
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nombre o cédula…"
                      value={buscarPersona}
                      onChange={(e) => setBuscarPersona(e.target.value)}
                      className="h-9 pl-7 text-sm"
                    />
                  </div>
                  {buscarPersona.trim() && (
                    <div className="mt-1 max-h-48 divide-y overflow-y-auto rounded border">
                      {personasFiltradas.length === 0 ? (
                        <p className="p-3 text-center text-xs text-muted-foreground">
                          Nadie coincide.
                        </p>
                      ) : (
                        personasFiltradas.map((p) => (
                          <button
                            key={p.identificacion}
                            type="button"
                            onClick={() => { setPersona(p); setBuscarPersona("") }}
                            className="flex w-full flex-col px-2 py-1.5 text-left hover:bg-muted/50"
                          >
                            <span className="truncate text-sm">{p.nombre}</span>
                            <span className="truncate font-mono text-[10px] text-muted-foreground">
                              {p.identificacion}
                              {p.cargo ? ` · ${p.cargo}` : ""}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <Label className="text-xs">Tipo de novedad</Label>
              <select
                value={novedad}
                onChange={(e) => setNovedad(e.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm"
              >
                {NOVEDADES_META.map((m) => (
                  <option key={m.valor} value={m.valor}>
                    {m.codigo ? `${m.codigo} · ` : ""}{m.etiqueta}
                  </option>
                ))}
              </select>
              {metaSel && (
                <div className="mt-1.5 rounded bg-muted/50 px-2 py-1.5 text-[11px] text-muted-foreground">
                  {metaSel.pagaElDia
                    ? "LIPgo paga el día."
                    : "El día no se paga: se descuenta de la quincena."}
                  {metaSel.bloqueaDominical && " Bloquea el descanso dominical siguiente."}
                  {metaSel.valor === "Retiro" &&
                    " Al guardar, la persona queda inactiva en Head Count."}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Desde</Label>
                <Input
                  type="date"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Hasta (opcional)</Label>
                <Input
                  type="date"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                  min={fechaDesde}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>
            {fechaHasta && fechaHasta > fechaDesde && (
              <p className="text-[11px] text-muted-foreground">
                Se aplica a todos los días del rango, incluidos los ya pasados.
              </p>
            )}

            <div>
              <Label className="text-xs">Observación</Label>
              <Textarea
                placeholder="Contexto para el analista de nómina"
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
                rows={2}
                className="mt-1 text-sm"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                La observación es para tu registro: hoy la novedad se guarda sin campo de nota.
              </p>
            </div>

            <Button
              className="w-full"
              disabled={!persona || !novedad || guardando}
              onClick={registrar}
            >
              {guardando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar novedad
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Queda vigente de inmediato y entra a la nómina de la quincena.
            </p>
          </div>
        </section>

        {/* ---------------- NOVEDADES DEL PERIODO ---------------- */}
        <section className="lg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Novedades del periodo</h2>
              {data && (
                <p className="text-xs text-muted-foreground">
                  {NUM.format(data.totales.eventos)} eventos ·{" "}
                  {NUM.format(data.totales.dias)} días
                  {data.totales.impactoNeto != null && (
                    <>
                      {" · impacto neto "}
                      <strong className={data.totales.impactoNeto < 0 ? "text-red-600" : "text-emerald-700"}>
                        {COP.format(data.totales.impactoNeto)}
                      </strong>
                    </>
                  )}
                </p>
              )}
            </div>
            <div className="flex gap-1">
              {([
                ["todas", "Todas"],
                ["descuentan", "Descuentan"],
                ["medicas", "Médicas"],
                ["arl", "ARL"],
              ] as [Filtro, string][]).map(([k, l]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={filtro === k ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setFiltro(k)}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>

          {cargando ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {error}
                </p>
              </div>
            </div>
          ) : visibles.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              {data?.novedades.length === 0
                ? "No hay novedades reportadas en esta quincena."
                : "Ninguna novedad coincide con el filtro."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border lg-eyebrow">
                    <th className="px-3 py-2 text-left font-medium">Trabajador</th>
                    <th className="px-2 py-2 text-left font-medium">Novedad</th>
                    <th className="px-2 py-2 text-left font-medium">Fechas</th>
                    <th className="px-2 py-2 text-right font-medium">Cant.</th>
                    <th className="px-2 py-2 text-left font-medium">Estado</th>
                    <th className="px-3 py-2 text-right font-medium">Impacto</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((n: NovedadPeriodo) => (
                    <tr
                      key={`${n.id}-${n.fecha}`}
                      className={`border-b border-border last:border-0 ${n.estado === "en_tramite_arl" ? "bg-red-50/40" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <p className="max-w-[180px] truncate font-medium">{n.trabajador}</p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          CC {n.identificacion}
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] font-medium text-white"
                            style={{ background: n.color }}
                          >
                            {n.sigla}
                          </span>
                          <span className="max-w-[190px] truncate text-xs">{n.etiqueta}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-foreground">
                        {n.fechaFin && n.fechaFin !== n.fecha
                          ? `${n.fecha.slice(8)}–${n.fechaFin.slice(8)} ${n.fecha.slice(5, 7)}`
                          : n.fecha.slice(5)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums">
                        {n.dias ?? 1} {(n.dias ?? 1) === 1 ? "día" : "días"}
                      </td>
                      <td className="px-2 py-2">
                        {n.estado === "en_tramite_arl" ? (
                          <span className="whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800">
                            En trámite ARL
                          </span>
                        ) : (
                          <span className="whitespace-nowrap rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                            Registrada
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {n.impacto == null ? (
                          <span
                            className="text-muted-foreground"
                            title="No se pudo calcular: esta persona no tiene días trabajados en la quincena para comparar."
                          >
                            —
                          </span>
                        ) : n.impacto === 0 ? (
                          <span className="text-xs text-muted-foreground">sin efecto</span>
                        ) : (
                          <span
                            className={`text-xs font-medium tabular-nums ${n.impacto < 0 ? "text-red-600" : "text-emerald-700"}`}
                          >
                            {n.impacto > 0 ? "+" : ""}
                            {COP.format(n.impacto)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-border px-4 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              El impacto es lo liquidado con la novedad menos lo que la persona habría ganado un día
              normal, tomado de la misma vista que paga la nómina. Un guion significa que no se
              pudo calcular — nunca un estimado.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
