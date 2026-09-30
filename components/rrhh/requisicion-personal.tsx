"use client"

// SOLICITUD DE PERSONAL — requisición con causal legal y costo estimado.
//
// Izquierda: el formulario, con la causal del Art. 77 Ley 50/1990 y su plazo
// máximo visible, más el costo mensual que implica la vacante.
// Derecha: las requisiciones en curso con su avance real.
//
// "Todo amarrado" (gerencia, 2026-09-30): el cargo se elige de la lista fija
// de Head Count, el puesto del maestro de turnos (el mismo que programa el
// coordinador) y el turno de los turnos definidos para la planta. El salario
// se sugiere con la mediana de lo que ganan los activos con ese cargo y se
// contrasta con el SMLV. Nada se escribe a mano salvo que el catálogo no
// tenga la opción ("Otro…").
//
// El costo NO usa un factor quemado: suma los porcentajes reales de
// `parametros_prestaciones` y `parametros_parafiscales`, que son editables
// porque la ley cambia.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, Info, Link2, Loader2, Scale, Send, Users } from "lucide-react"
import {
  crearRequisicion,
  getCatalogosRequisicion,
  getFactoresCosto,
  getRequisiciones,
  type CatalogosRequisicion,
  type RequisicionResumen,
} from "@/lib/requisicion-actions"
import {
  CAUSALES_TEMPORALES,
  calcularCostoVacante,
  causalPorId,
  type FactoresCosto,
} from "@/lib/requisicion-causales"

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

const OTRO = "__otro__"
const SELECT = "mt-1 w-full rounded border bg-background px-2 py-2 text-sm"

type Factores = FactoresCosto & { detalle: string[]; aiuDeclarado: boolean }

/** Barra de avance de 5 pasos. */
function Avance({ paso }: { paso: number }) {
  return (
    <div className="mt-1.5 flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className="h-1 flex-1 rounded-full"
          style={{ background: paso >= n ? "#0d9488" : "#e2e8f0" }}
        />
      ))}
    </div>
  )
}

export default function RequisicionPersonal() {
  const { toast } = useToast()
  const { selectedEmpresaId } = useAuth()

  const [reqs, setReqs] = useState<RequisicionResumen[]>([])
  const [factores, setFactores] = useState<Factores | null>(null)
  const [avisoFactores, setAvisoFactores] = useState<string | null>(null)
  const [catalogos, setCatalogos] = useState<CatalogosRequisicion | null>(null)
  const [avisoCatalogos, setAvisoCatalogos] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)

  // Formulario
  const [cargo, setCargo] = useState("")
  const [cargoOtro, setCargoOtro] = useState("")
  const [puesto, setPuesto] = useState("")
  const [vacantes, setVacantes] = useState("1")
  const [causal, setCausal] = useState<string>("")
  const [salario, setSalario] = useState("")
  // true mientras el salario sea el sugerido por el cargo (se reemplaza al cambiar de cargo).
  const [salarioSugerido, setSalarioSugerido] = useState(false)
  const [turno, setTurno] = useState("")
  const [turnoOtro, setTurnoOtro] = useState("")
  const [ciudad, setCiudad] = useState("")
  const [requisitos, setRequisitos] = useState("")
  const [aiu, setAiu] = useState("0")

  const cargar = useCallback(async () => {
    setCargando(true)
    const [r, f, c] = await Promise.all([
      getRequisiciones(selectedEmpresaId ?? null),
      getFactoresCosto(selectedEmpresaId ?? null),
      getCatalogosRequisicion(selectedEmpresaId ?? null),
    ])
    if (r.success && r.data) setReqs(r.data)
    if (f.success && f.data) {
      setFactores(f.data)
      setAvisoFactores(null)
    } else {
      setFactores(null)
      setAvisoFactores(f.message ?? "No se pudieron leer los parámetros de costo.")
    }
    if (c.success && c.data) {
      setCatalogos(c.data)
      setAvisoCatalogos(null)
      setCiudad((prev) => prev || c.data!.ciudad || "")
    } else {
      setCatalogos(null)
      setAvisoCatalogos(c.message ?? "No se pudieron leer los catálogos de cargos y turnos.")
    }
    setCargando(false)
  }, [selectedEmpresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const causalSel = causalPorId(causal)
  const cargoFinal = cargo === OTRO ? cargoOtro.trim() : cargo
  const turnoFinal = turno === OTRO ? turnoOtro.trim() : turno
  const cargoCat = catalogos?.cargos.find((c) => c.cargo === cargo) ?? null
  const puestoCat = catalogos?.puestos.find((p) => p.puesto === puesto) ?? null
  const smlv = catalogos?.smlv ?? null
  const bajoMinimo = smlv != null && Number(salario) > 0 && Number(salario) < smlv

  const onCargo = (v: string) => {
    setCargo(v)
    const c = catalogos?.cargos.find((x) => x.cargo === v)
    if (c?.salarioReferencia && (salarioSugerido || !salario)) {
      setSalario(String(c.salarioReferencia))
      setSalarioSugerido(true)
    }
  }
  const onPuesto = (p: string) => {
    setPuesto(p)
    // Si el puesto trae hora de entrada y hay un turno con esa hora, se propone.
    const pc = catalogos?.puestos.find((x) => x.puesto === p)
    if (pc?.horaEntrada && !turnoFinal) {
      const t = catalogos?.turnos.find((x) => x.horaInicio === pc.horaEntrada)
      if (t) setTurno(t.etiqueta)
    }
  }

  const costo = useMemo(() => {
    if (!factores) return null
    const s = Number(salario) || 0
    const v = Number(vacantes) || 0
    if (s <= 0 || v <= 0) return null
    return calcularCostoVacante(s, v, { ...factores, pctAiu: Number(aiu) || 0 })
  }, [factores, salario, vacantes, aiu])

  async function enviar() {
    if (!selectedEmpresaId) return
    setGuardando(true)
    const r = await crearRequisicion({
      empresaId: selectedEmpresaId,
      cargo: cargoFinal,
      vacantes: Number(vacantes) || 0,
      causal,
      salarioMensual: Number(salario) || 0,
      turno: turnoFinal || null,
      ciudad: ciudad || null,
      requisitos: requisitos || null,
      puesto: puesto || null,
    })
    setGuardando(false)
    if (!r.success) {
      toast({ title: "No se pudo enviar", description: r.message, variant: "destructive" })
      return
    }
    toast({
      title: "Requisición enviada",
      description: r.message ?? "Queda pendiente de aprobación de RRHH y Operaciones.",
    })
    setCargo(""); setCargoOtro(""); setPuesto(""); setVacantes("1"); setCausal(""); setSalario(""); setSalarioSugerido(false)
    setTurno(""); setTurnoOtro(""); setRequisitos("")
    cargar()
  }

  const puedeEnviar = !!cargoFinal && !!causal && Number(vacantes) > 0 && Number(salario) > 0 && !guardando

  return (
    <div className="space-y-4 p-4">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Requisición</p>
        <h1 className="text-xl font-semibold">Solicitud de personal</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---------------- FORMULARIO ---------------- */}
        <section className="h-fit rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Solicitar personal en misión{catalogos?.proyecto ? ` · ${catalogos.proyecto}` : ""}</h2>
            <p className="text-xs text-muted-foreground">
              Cargo, puesto y turno salen de los catálogos de la planta. La causal define el plazo máximo permitido por ley.
            </p>
          </div>

          <div className="space-y-3 p-4">
            {avisoCatalogos && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {avisoCatalogos} Puedes escribir los datos a mano.
                </p>
              </div>
            )}

            {/* CARGO + VACANTES */}
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <Label className="text-xs">Cargo requerido</Label>
                <select value={cargo} onChange={(e) => onCargo(e.target.value)} className={SELECT}>
                  <option value="">Selecciona el cargo…</option>
                  {(catalogos?.cargos ?? []).map((c) => (
                    <option key={c.cargo} value={c.cargo}>
                      {c.cargo}
                      {c.activos ? ` · ${c.activos} activo${c.activos === 1 ? "" : "s"}` : ""}
                    </option>
                  ))}
                  <option value={OTRO}>Otro cargo…</option>
                </select>
                {cargo === OTRO && (
                  <Input
                    value={cargoOtro}
                    onChange={(e) => setCargoOtro(e.target.value)}
                    placeholder="Escribe el cargo"
                    className="mt-1 h-9 text-sm"
                  />
                )}
                {cargoCat && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {cargoCat.activos
                      ? `${cargoCat.activos} activo${cargoCat.activos === 1 ? "" : "s"} con este cargo en la planta`
                      : "Sin activos con este cargo en la planta"}
                    {cargoCat.salarioReferencia ? ` · salario de referencia ${COP.format(cargoCat.salarioReferencia)}` : ""}
                  </p>
                )}
              </div>
              <div className="w-28">
                <Label className="text-xs">Vacantes</Label>
                <Input
                  type="number"
                  min={1}
                  value={vacantes}
                  onChange={(e) => setVacantes(e.target.value)}
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>

            {/* PUESTO + TURNO */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Puesto operativo</Label>
                <select value={puesto} onChange={(e) => onPuesto(e.target.value)} className={SELECT}>
                  <option value="">Sin puesto específico</option>
                  {(catalogos?.puestos ?? []).map((p) => (
                    <option key={p.puesto} value={p.puesto}>
                      {p.puesto}
                      {p.especialidad ? " · especialidad" : ""}
                    </option>
                  ))}
                </select>
                {puestoCat && (puestoCat.horaEntrada || puestoCat.tarifaBase) && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {puestoCat.horaEntrada ? `Entrada ${puestoCat.horaEntrada}` : ""}
                    {puestoCat.horaEntrada && puestoCat.tarifaBase ? " · " : ""}
                    {puestoCat.tarifaBase ? `tarifa base ${COP.format(puestoCat.tarifaBase)} por turno` : ""}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Turno previsto</Label>
                <select value={turno} onChange={(e) => setTurno(e.target.value)} className={SELECT}>
                  <option value="">Selecciona el turno…</option>
                  {(catalogos?.turnos ?? []).map((t) => (
                    <option key={t.codigo} value={t.etiqueta}>
                      {t.nombre !== t.codigo ? `${t.nombre} · ${t.horaInicio}${t.horaFin ? `–${t.horaFin}` : ""}` : t.etiqueta}
                    </option>
                  ))}
                  <option value={OTRO}>Otro horario…</option>
                </select>
                {turno === OTRO && (
                  <Input
                    value={turnoOtro}
                    onChange={(e) => setTurnoOtro(e.target.value)}
                    placeholder="T1 · 06:00–14:00"
                    className="mt-1 h-9 text-sm"
                  />
                )}
              </div>
            </div>

            <div>
              <Label className="text-xs">Causal de contratación temporal</Label>
              <select value={causal} onChange={(e) => setCausal(e.target.value)} className={SELECT}>
                <option value="">Selecciona la causal…</option>
                {CAUSALES_TEMPORALES.map((c) => (
                  <option key={c.id} value={c.id}>{c.etiqueta}</option>
                ))}
              </select>
            </div>

            {/* El plazo legal de la causal elegida. */}
            {causalSel && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-sky-900">
                  <Scale className="h-3.5 w-3.5" />
                  Plazo máximo: {causalSel.plazo}
                </p>
                <p className="mt-1 text-[11px] text-sky-800">{causalSel.norma}</p>
                <p className="mt-1 text-[11px] text-sky-800">{causalSel.nota}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Salario mensual (COP)</Label>
                <Input
                  type="number"
                  min={0}
                  value={salario}
                  onChange={(e) => {
                    setSalario(e.target.value)
                    setSalarioSugerido(false)
                  }}
                  placeholder={smlv ? String(smlv) : "1750905"}
                  className="mt-1 h-9 text-sm"
                />
                {salarioSugerido && salario && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Link2 className="h-3 w-3" /> Sugerido por el cargo; puedes cambiarlo.
                  </p>
                )}
                {bajoMinimo && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> Por debajo del mínimo vigente ({COP.format(smlv!)}).
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Ciudad</Label>
                <Input
                  value={ciudad}
                  onChange={(e) => setCiudad(e.target.value)}
                  placeholder="Bogotá"
                  className="mt-1 h-9 text-sm"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Perfil y requisitos</Label>
              <Textarea
                value={requisitos}
                onChange={(e) => setRequisitos(e.target.value)}
                placeholder="Bachiller, 1 año de experiencia en planta, curso de alturas vigente"
                rows={2}
                className="mt-1 text-sm"
              />
            </div>

            {/* COSTO ESTIMADO */}
            {avisoFactores ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {avisoFactores}
                </p>
              </div>
            ) : costo ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Costo mensual estimado
                    </p>
                    <p className="text-2xl font-semibold tabular-nums">{COP.format(costo.total)}</p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    <p>Factor ×{costo.factor.toFixed(2)} sobre el salario</p>
                    <p>{Number(vacantes) || 0} vacante(s)</p>
                  </div>
                </div>

                <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <li className="flex justify-between">
                    <span>Salario</span>
                    <span className="tabular-nums">{COP.format(costo.salarioTotal)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Prestaciones sociales</span>
                    <span className="tabular-nums">{COP.format(costo.prestaciones)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Aportes patronales</span>
                    <span className="tabular-nums">{COP.format(costo.aportes)}</span>
                  </li>
                  {costo.aiu > 0 && (
                    <li className="flex justify-between">
                      <span>Administración (AIU)</span>
                      <span className="tabular-nums">{COP.format(costo.aiu)}</span>
                    </li>
                  )}
                </ul>

                <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
                  <Label className="text-[11px] text-muted-foreground">AIU %</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={aiu}
                    onChange={(e) => setAiu(e.target.value)}
                    className="h-7 w-20 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    El margen no está configurado en el sistema: arranca en 0 para no cotizar con
                    uno que nadie definió.
                  </p>
                </div>

                {factores?.detalle?.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      Cómo se compone
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
                      {factores.detalle.map((d) => (
                        <li key={d} className="flex items-start gap-1">
                          <Info className="mt-0.5 h-3 w-3 shrink-0" />
                          {d}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                Elige el cargo (o indica salario) y las vacantes para ver el costo mensual.
              </p>
            )}

            <Button className="w-full gap-1.5" disabled={!puedeEnviar} onClick={enviar}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar requisición
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              Queda pendiente de aprobación de RRHH y de Operaciones.
            </p>
          </div>
        </section>

        {/* ---------------- REQUISICIONES EN CURSO ---------------- */}
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Requisiciones en curso</h2>
          </div>

          {cargando ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : reqs.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No hay requisiciones registradas para esta empresa.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {reqs.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.cargo}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {r.codigo} · {r.vacantes} vacante{r.vacantes === 1 ? "" : "s"}
                        {r.causal ? ` · ${causalPorId(r.causal)?.etiqueta ?? r.causal}` : " · sin causal registrada"}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        background:
                          r.estado === "aprobado" ? "#dcfce7"
                          : r.estado === "rechazado" ? "#fee2e2" : "#fef3c7",
                        color:
                          r.estado === "aprobado" ? "#166534"
                          : r.estado === "rechazado" ? "#991b1b" : "#92400e",
                      }}
                    >
                      {r.pasoEtiqueta}
                    </span>
                  </div>
                  <Avance paso={r.paso} />
                  <p className="mt-1 text-[11px] text-muted-foreground">{r.detalle}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-border px-4 py-2.5">
            <p className="text-[11px] text-muted-foreground">
              El avance llega hasta donde el sistema sabe: solicitada y aprobada. Los pasos de
              selección, terna y contratación todavía no se registran en LIPgo, así que no se
              marcan solos.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
