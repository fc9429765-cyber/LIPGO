"use client"

// DASHBOARD DE PEDIDOS — indicadores logísticos del cliente por período.
// Reconstrucción total (gerencia 2026-10-03): un solo selector de período gobierna
// toda la pantalla; cada bloque responde a una pregunta del gerente y termina en una
// acción hacia Gestionar pedidos. Fuera lo comercial (vendedores, facturado, ticket) y
// lo que no tiene datos (flete, demora, In-Full con campos vacíos).
// Datos: lib/dashboard-pedidos-periodo-actions.ts (consultas acotadas al período).

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Cifra, Esqueleto, Eyebrow } from "@/components/ui/lipgo"
import { useAuth } from "@/components/auth-provider"
import { getDashboardPedidosPeriodo, type DashboardPedidosPeriodo } from "@/lib/dashboard-pedidos-periodo-actions"
import { PRESETS_PERIODO, etiquetaRango, rangoDe, validarRango, type PresetPeriodo } from "@/lib/periodo-rango"
import { hoyBogotaISO } from "@/lib/periodo-listados"
import { COP, NUM, T1, tTexto } from "./gestionar/formato"
import { BloqueAnticipacion, BloqueAtraso, BloqueCierreHoy, BloqueCompletitud, BloqueCumplimiento, BloqueNoEntregados, BloquePendiente, BloqueVolumen, pct } from "./dashboard-pedidos/bloques"

const presetInicial = (hoy: string): PresetPeriodo => (Number(hoy.slice(8, 10)) < 5 ? "mes_anterior" : "mes")

export function DashboardPedidos() {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const [hoy] = useState(() => hoyBogotaISO())
  const [preset, setPreset] = useState<PresetPeriodo>(() => presetInicial(hoyBogotaISO()))
  const [rango, setRango] = useState(() => rangoDe(presetInicial(hoyBogotaISO()), hoyBogotaISO()))
  const [desdeInput, setDesdeInput] = useState(rango.desde)
  const [hastaInput, setHastaInput] = useState(rango.hasta)
  const [errorRango, setErrorRango] = useState<string | null>(null)
  const [data, setData] = useState<DashboardPedidosPeriodo | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!selectedEmpresaId) return
    setCargando(true)
    const r = await getDashboardPedidosPeriodo(selectedEmpresaId, rango.desde, rango.hasta)
    if (r.success) {
      setData(r.data)
      setError(null)
    } else setError(r.message)
    setCargando(false)
  }, [selectedEmpresaId, rango])

  useEffect(() => {
    setData(null)
    cargar()
  }, [cargar])

  const elegirPreset = (p: PresetPeriodo) => {
    setPreset(p)
    setErrorRango(null)
    if (p !== "rango") {
      const r = rangoDe(p, hoy)
      setRango(r)
      setDesdeInput(r.desde)
      setHastaInput(r.hasta)
    }
  }
  const aplicarRango = () => {
    const err = validarRango(desdeInput, hastaInput)
    setErrorRango(err)
    if (!err) setRango({ desde: desdeInput, hasta: hastaInput })
  }

  const f = data?.franja
  const pA = f ? pct(f.aTiempo, f.conFecha) : null
  const pKg = f && f.kg > 0 ? Math.round((f.kgCargados / f.kg) * 100) : null
  const pMismo = f ? pct(f.mismoDia, f.conPromesa) : null

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Pedidos y solicitudes · Dashboard</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Indicadores logísticos</h1>
          <p className="lg-num mt-0.5 text-[13px] text-muted-foreground">
            {selectedEmpresaNombre || (selectedEmpresaId ? `ID ${selectedEmpresaId}` : "Selecciona un proyecto")} · {etiquetaRango(rango.desde, rango.hasta)} · por fecha prometida{f ? ` · ${NUM.format(f.clientes)} clientes` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Período</span>
        {PRESETS_PERIODO.map((p) => (
          <button key={p.valor} type="button" onClick={() => elegirPreset(p.valor)} className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${preset === p.valor ? "border-marca bg-marca text-white" : "border-input bg-background hover:bg-accent"}`}>
            {p.etiqueta}
          </button>
        ))}
        {preset === "rango" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={desdeInput} onChange={(e) => setDesdeInput(e.target.value)} className="h-8 w-[150px] text-xs" aria-label="Desde" />
            <span className="text-xs text-muted-foreground">a</span>
            <Input type="date" value={hastaInput} onChange={(e) => setHastaInput(e.target.value)} className="h-8 w-[150px] text-xs" aria-label="Hasta" />
            <Button size="sm" className="h-8 text-xs" onClick={aplicarRango}>Aplicar</Button>
            {errorRango && <span className="text-xs text-critico-fg">{errorRango}</span>}
          </div>
        )}
        <span className="hidden text-xs text-muted-foreground lg:ml-auto lg:inline">Un solo período gobierna toda la pantalla. "Pendiente y atraso" y "Cierre del día" son la foto de hoy.</span>
      </div>

      {error && (
        <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-3 text-sm text-atencion-fg">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={cargar}>Reintentar</Button>
        </div>
      )}

      {!data || !f ? (
        <>
          <section className="lg-card grid grid-cols-2 gap-6 p-5 lg:grid-cols-5" aria-busy>
            {Array.from({ length: 5 }).map((_, i) => <Esqueleto key={i} lineas={3} />)}
          </section>
          <div className="grid gap-4 lg:grid-cols-[7fr_5fr]">
            <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
            <div className="lg-card p-5"><Esqueleto lineas={5} /></div>
          </div>
        </>
      ) : (
        <>
          <section className="lg-card grid grid-cols-1 gap-y-5 p-5 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-5 lg:gap-y-0" aria-label="Resumen del período">
            <div className="lg:border-r lg:border-border lg:pr-5">
              <Cifra
                label="Pedidos prometidos"
                valor={NUM.format(f.pedidos)}
                unidad="en el período"
                sub={`${tTexto(f.kg)} · ${NUM.format(f.clientes)} clientes${data.mostrarDinero ? ` · ${COP.format(f.dinero)}` : ""}${f.anulados ? ` · ${f.anulados} anulados` : ""}`}
              />
            </div>
            <div className="lg:border-r lg:border-border lg:px-5">
              <Cifra
                label="A tiempo"
                valor={pA == null ? "—" : `${pA} %`}
                unidad={f.conFecha > 0 ? `${NUM.format(f.aTiempo)} de ${NUM.format(f.conFecha)} con fecha de cargue` : "sin cargues aún"}
                tono={pA == null ? "neutro" : pA >= 90 ? "ok" : pA >= 75 ? "atencion" : "critico"}
                progreso={pA ?? undefined}
                sub={f.tarde > 0 ? `${NUM.format(f.tarde)} cargaron después de la promesa` : "ninguno tarde"}
              />
            </div>
            <div className="lg:border-r lg:border-border lg:px-5">
              <Cifra
                label="Kilos cargados"
                valor={T1.format(f.kgCargados / 1000)}
                unidad={`t de ${T1.format(f.kg / 1000)} t prometidas`}
                progreso={pKg ?? undefined}
                sub={`dato de cargue en ${NUM.format(f.conCargado)} de ${NUM.format(f.pedidos)} pedidos`}
              />
            </div>
            <div className="lg:border-r lg:border-border lg:px-5">
              <Cifra
                label="Pendientes del período"
                valor={NUM.format(f.pendientes)}
                unidad="sin orden de cargue"
                tono={f.pendientes > 0 ? "critico" : "ok"}
                sub={f.pendientes > 0 ? `${tTexto(f.kgPendientes)} · entran en Atrasados` : "todo con orden de cargue"}
              />
            </div>
            <div className="lg:pl-5">
              <Cifra
                label="Mismo día"
                valor={pMismo == null ? "—" : `${pMismo} %`}
                unidad={`${NUM.format(f.mismoDia)} registrados el día de la entrega`}
                tono={pMismo != null && pMismo > 50 ? "atencion" : "neutro"}
                sub="anticipación del pedido, abajo"
              />
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[7fr_5fr]">
            <div className="flex flex-col gap-4">
              <BloqueCumplimiento d={data} />
              <BloqueCompletitud d={data} />
              <BloqueVolumen d={data} />
            </div>
            <div className="flex flex-col gap-4">
              <BloquePendiente d={data} />
              <BloqueAtraso d={data} />
              <BloqueCierreHoy d={data} />
              <BloqueAnticipacion d={data} />
              <BloqueNoEntregados d={data} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default DashboardPedidos
