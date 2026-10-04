"use client"

// OPERACIÓN DEL DÍA — panel ejecutivo del coordinador.
//
// Reúne en una pantalla lo que hoy está repartido: vehículos y toneladas del
// día, programación del cliente, personal y cobertura, bandeja de pendientes,
// solicitudes de personal y cierre del día. Todo filtrado por la empresa del
// selector global y TODO real: cada cifra sale de la misma fuente que ya usa
// su módulo (no se recalcula nada por una vía propia). Los botones llevan al
// módulo donde se resuelve.
//
// Visual (2026-10-02, sistema visual LIPgo): cuatro cifras mandan arriba;
// debajo, la bandeja con acciones, vehículos por tipo, personal, programación
// de mañana y cierre. Primitivas en components/ui/lipgo.tsx.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Chip, Cifra, Esqueleto, EstadoVacio, Eyebrow, FilaAccion, Progreso, Seccion, type Tono } from "@/components/ui/lipgo"
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Printer,
  RefreshCw,
  Scale,
  Truck,
  UserPlus,
} from "lucide-react"
import { getOperacionDia } from "@/lib/operacion-dia-actions"
import { createBitacora } from "@/lib/bitacora-actions"
import type { CoberturaTurno, ItemBandeja, OperacionDiaData } from "@/lib/operacion-dia-tipos"

const NUM = new Intl.NumberFormat("es-CO")
const T1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })

/** Abre otro módulo. El destino conserva su propio PermissionGuard. */
function irAModulo(nombre: string) {
  window.dispatchEvent(new CustomEvent("lipgo:navigate-module", { detail: nombre }))
}

const TONO_NIVEL: Record<ItemBandeja["nivel"], Tono> = { alto: "critico", medio: "atencion", bajo: "info" }

const fechaLarga = (iso: string) => {
  const s = new Date(`${iso}T12:00:00-05:00`).toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const horaCorta = (ts: string) => new Date(ts).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })
const duracion = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`)

/** Renglón de la lista de cierre. `children` = acción en línea (p. ej. anotar la bitácora). */
function ItemCierre({
  ok,
  texto,
  pendiente,
  modulo,
  boton,
  children,
}: {
  ok: boolean
  texto: string
  pendiente: string
  modulo?: string
  boton?: string
  children?: React.ReactNode
}) {
  return (
    <li className="px-4 py-2.5 sm:px-5">
      <div className="flex items-center gap-3">
        {ok ? (
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-acento text-white">
            <CheckCircle2 className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-input" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${ok ? "text-muted-foreground" : "font-medium"}`}>{texto}</p>
          {!ok && <p className="text-[11px] text-atencion-fg">{pendiente}</p>}
        </div>
        {!ok && modulo && boton && (
          <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={() => irAModulo(modulo)}>
            {boton}
          </Button>
        )}
      </div>
      {!ok && children && <div className="mt-2 pl-[34px]">{children}</div>}
    </li>
  )
}

function TarjetaTurno({ t }: { t: CoberturaTurno }) {
  const pct = t.programados > 0 ? Math.round((t.presentes / t.programados) * 100) : 0
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1.5 rounded-xl bg-muted/50 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">{t.etiqueta}</span>
        {t.horario && <span className="lg-num text-[11px] text-muted-foreground">{t.horario}</span>}
      </div>
      <p className="lg-num text-2xl font-bold leading-none">
        {t.presentes === 0 && t.programados === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={pct >= 95 ? "" : "text-atencion-fg"}>{t.presentes}</span>
        )}
        <span className="text-sm font-normal text-muted-foreground"> / {t.programados}</span>
      </p>
      <Progreso pct={pct} tono={pct >= 95 ? undefined : "atencion"} />
      <p className="lg-num text-[11px] text-muted-foreground">
        {t.programados === 0 ? "sin turnos programados" : t.sinMarcar > 0 ? `${t.sinMarcar} sin marcar` : `${pct} % confirmado`}
      </p>
    </div>
  )
}

/** Barra horizontal por tipo de vehículo (escala al mayor). */
function BarrasTipo({ filas, total }: { filas: { tipo: string; n: number }[]; total: number }) {
  const max = Math.max(1, ...filas.map((f) => f.n))
  return (
    <div className="flex flex-col gap-2.5">
      {filas.slice(0, 6).map((f, i) => (
        <div key={f.tipo} className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-2.5">
          <span className="truncate text-[13px] font-medium" title={f.tipo}>{f.tipo}</span>
          <div className="h-3.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(f.n / max) * 100}%`, background: i === 0 ? "#0F766E" : i === 1 ? "#0D9488" : "#5EEAD4" }} />
          </div>
          <span className="lg-num text-right text-[13px] font-semibold">{f.n}</span>
        </div>
      ))}
      {filas.length === 0 && <p className="text-xs text-muted-foreground">Aún no hay vehículos registrados hoy en portería.</p>}
      {total > 0 && filas.length > 6 && <p className="text-[11px] text-muted-foreground">y {filas.length - 6} tipo{filas.length - 6 === 1 ? "" : "s"} más</p>}
    </div>
  )
}

export function OperacionDelDia() {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const [data, setData] = useState<OperacionDiaData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Anotación rápida de la bitácora desde el cierre del día (misma acción que
  // usa el módulo Bitácora; no se recalcula nada aquí).
  const [nota, setNota] = useState("")
  const [guardandoNota, setGuardandoNota] = useState(false)
  const [errorNota, setErrorNota] = useState<string | null>(null)
  const [actualizadoEn, setActualizadoEn] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await getOperacionDia(selectedEmpresaId ?? null)
    if (r.success && r.data) {
      setData(r.data)
      setActualizadoEn(new Date().toISOString())
    } else {
      setData(null)
      setError(r.message ?? "No se pudo cargar el panel.")
    }
    setCargando(false)
  }, [selectedEmpresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function guardarNota() {
    if (!selectedEmpresaId || !nota.trim()) return
    setGuardandoNota(true)
    setErrorNota(null)
    const r = await createBitacora(selectedEmpresaId, { bitacora: nota.trim() })
    setGuardandoNota(false)
    if (!r.success) {
      setErrorNota(r.error ?? "No se pudo guardar la anotación.")
      return
    }
    setNota("")
    cargar()
  }

  if (cargando && !data) {
    return (
      <div className="flex flex-col gap-4 p-3 sm:p-4" aria-busy>
        <div className="lg-card grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
          <Esqueleto lineas={3} />
          <Esqueleto lineas={3} />
          <Esqueleto lineas={3} />
          <Esqueleto lineas={3} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[7fr_5fr]">
          <div className="lg-card p-5"><Esqueleto lineas={6} /></div>
          <div className="lg-card p-5"><Esqueleto lineas={5} /></div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-4 text-sm text-atencion-fg">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={cargar}>Reintentar</Button>
        </div>
      </div>
    )
  }

  const d = data
  const oh = d.operacionHoy
  const prog = oh.programacion
  const pctMeta = oh.metaTonDia > 0 ? Math.round((oh.toneladas / oh.metaTonDia) * 100) : null
  const faltanTon = oh.metaTonDia > 0 ? Math.max(0, oh.metaTonDia - oh.toneladas) : 0
  const pctPersonal = d.hoy.total.programados > 0 ? Math.round((d.hoy.total.presentes / d.hoy.total.programados) * 100) : null

  // Cierre del día: puntos listos / total (la programación de mañana solo si la empresa la usa).
  const puntosCierre: boolean[] = [
    d.cierre.vehiculosSinCerrar === 0,
    d.cierre.sinMarcar === 0,
    d.cierre.turnosPorAprobar === 0,
    ...(d.cierre.programacionManana.usa ? [d.cierre.programacionManana.recibida] : []),
    d.cierre.bitacoraHoy,
  ]
  const listos = puntosCierre.filter(Boolean).length
  const faltanCierre: string[] = []
  if (d.cierre.vehiculosSinCerrar > 0) faltanCierre.push(`${d.cierre.vehiculosSinCerrar} sin cerrar`)
  if (d.cierre.sinMarcar > 0) faltanCierre.push(`${d.cierre.sinMarcar} sin marcar`)
  if (d.cierre.turnosPorAprobar > 0) faltanCierre.push("turnos")
  if (d.cierre.programacionManana.usa && !d.cierre.programacionManana.recibida) faltanCierre.push("programación")
  if (!d.cierre.bitacoraHoy) faltanCierre.push("bitácora")

  const despachoTexto = oh.porDespacho.map((p) => `${p.tipo.toLowerCase()} ${p.n}`).join(" · ")
  const promAux = oh.auxiliares.length > 0 ? oh.auxiliares.reduce((s, a) => s + a.ton, 0) / oh.auxiliares.length : 0

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      {/* Cabecera */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>{fechaLarga(d.fecha)} · {selectedEmpresaNombre || `ID ${selectedEmpresaId}`}</Eyebrow>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Operación del día</h1>
        </div>
        <div className="flex items-center gap-2">
          {actualizadoEn && <span className="lg-num hidden text-xs text-muted-foreground sm:inline">Actualizado {horaCorta(actualizadoEn)}</span>}
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex" onClick={() => irAModulo("Bitácora")}>
            <Printer className="h-3.5 w-3.5" />
            Cierre en PDF
          </Button>
        </div>
      </div>

      {/* Avisos de datos que no se pudieron leer: nunca mostrar 0 como si fuera real. */}
      {d.avisos.length > 0 && (
        <div className="rounded-xl border border-atencion-bd bg-atencion-bg p-3 text-xs text-atencion-fg">
          {d.avisos.map((a) => (
            <p key={a} className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {a}
            </p>
          ))}
        </div>
      )}

      {/* FRANJA DEL DÍA — las cuatro cifras que mandan */}
      <section className="lg-card grid grid-cols-1 gap-y-5 p-5 sm:grid-cols-2 sm:gap-x-6 lg:grid-cols-4 lg:gap-y-0">
        <div className="lg:border-r lg:border-border lg:pr-6">
          {oh.disponible ? (
            <Cifra
              label="Vehículos hoy"
              valor={NUM.format(oh.vehiculosRegistrados || oh.ordenesHoy)}
              unidad={oh.vehiculosRegistrados ? "en portería" : "órdenes"}
              chips={
                <>
                  <Chip tono="neutro">{NUM.format(oh.ordenesHoy)} órdenes</Chip>
                  <Chip tono={oh.sinCerrar > 0 ? "atencion" : "ok"}>{NUM.format(oh.sinCerrar)} sin cerrar</Chip>
                  <Chip tono={oh.enPatio > 3 ? "atencion" : "info"}>{NUM.format(oh.enPatio)} en patio</Chip>
                </>
              }
            />
          ) : (
            <Cifra label="Vehículos hoy" valor="—" sub={oh.mensaje ?? "No se pudo leer la operación de hoy"} tono="atencion" />
          )}
        </div>
        <div className="lg:border-r lg:border-border lg:px-6">
          <Cifra
            label="Toneladas cerradas"
            valor={T1.format(oh.toneladas)}
            unidad={oh.metaTonDia > 0 ? `t de ${T1.format(oh.metaTonDia)} meta` : "t"}
            progreso={pctMeta ?? undefined}
            tono={pctMeta != null && pctMeta < 60 ? "atencion" : "neutro"}
            sub={
              pctMeta != null
                ? `${pctMeta} % de la meta del día${faltanTon > 0 ? ` · faltan ${T1.format(faltanTon)} t` : " · meta cumplida"}`
                : `${oh.finalizadas} finalizados de ${oh.ordenesHoy}`
            }
          />
        </div>
        <div className="lg:border-r lg:border-border lg:px-6">
          {prog.usa ? (
            <Cifra
              label="Programación del cliente"
              valor={prog.tiene ? (prog.porcentaje != null ? `${NUM.format(prog.porcentaje)} %` : "—") : "Sin"}
              unidad={prog.tiene ? `${prog.cumplidos} de ${prog.programados} llegaron` : "programación hoy"}
              tono={!prog.tiene ? "atencion" : prog.porcentaje != null && prog.porcentaje >= 90 ? "ok" : prog.porcentaje != null && prog.porcentaje >= 70 ? "atencion" : prog.porcentaje == null ? "neutro" : "critico"}
              chips={
                prog.tiene ? (
                  <>
                    <Chip tono={prog.aTiempo ? "ok" : "atencion"}>{prog.aTiempo ? "Enviada a tiempo" : "Enviada tarde"}{prog.enviadaEn ? ` · ${horaCorta(prog.enviadaEn)}` : ""}</Chip>
                    {prog.llegaron - prog.cumplidos > 0 && <Chip tono="neutro">+{prog.llegaron - prog.cumplidos} fuera de programación</Chip>}
                  </>
                ) : (
                  <Chip tono="neutro">{NUM.format(prog.llegaron)} llegaron sin programar</Chip>
                )
              }
            />
          ) : (
            <Cifra
              label="Personal en operación"
              valor={d.hoy.total.programados > 0 ? NUM.format(d.hoy.total.presentes) : "—"}
              unidad={d.hoy.total.programados > 0 ? `de ${NUM.format(d.hoy.total.programados)} programados` : "sin turnos programados"}
              progreso={pctPersonal ?? undefined}
              tono={pctPersonal != null && pctPersonal < 95 ? "atencion" : "neutro"}
              sub={d.hoy.total.sinMarcar > 0 ? `${d.hoy.total.sinMarcar} sin marcar · ${NUM.format(d.personalActivo)} activos en planta` : `${NUM.format(d.personalActivo)} activos en planta`}
            />
          )}
        </div>
        <div className="lg:pl-6">
          <Cifra
            label="Cierre del día"
            valor={
              <>
                {listos}
                <span className="text-muted-foreground/70">/{puntosCierre.length}</span>
              </>
            }
            unidad="puntos listos"
            tono={listos === puntosCierre.length ? "ok" : "neutro"}
            sub={faltanCierre.length > 0 ? `Faltan: ${faltanCierre.join(" · ")}` : "Listo para cerrar"}
          />
          <div className="mt-2 flex gap-1" aria-hidden>
            {puntosCierre.map((ok, i) => (
              <span key={i} className={`h-2 flex-1 rounded-full ${ok ? "bg-acento" : "bg-muted"}`} />
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[7fr_5fr]">
        {/* ===== Columna izquierda ===== */}
        <div className="flex flex-col gap-4">
          <Seccion
            eyebrow="Bandeja"
            titulo="Requiere tu atención"
            accion={<Chip tono={d.bandeja.some((b) => b.nivel === "alto") ? "critico" : d.bandeja.length ? "atencion" : "ok"}>{d.bandeja.length ? `${d.bandeja.length} pendiente${d.bandeja.length === 1 ? "" : "s"}` : "Todo al día"}</Chip>}
            sinPadding
          >
            {d.bandeja.length === 0 ? (
              <EstadoVacio icono={<CheckCircle2 className="h-5 w-5" />} titulo="Nada pendiente" texto="La operación está al día. Lo siguiente es el cierre del día." />
            ) : (
              <ul className="divide-y divide-border">
                {d.bandeja.map((it) => (
                  <FilaAccion
                    key={it.id}
                    tono={TONO_NIVEL[it.nivel]}
                    titulo={it.titulo}
                    detalle={it.detalle}
                    boton={it.moduloDestino ? (it.textoBoton ?? "Abrir") : undefined}
                    onClick={it.moduloDestino ? () => irAModulo(it.moduloDestino!) : undefined}
                  />
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion
            eyebrow="Operación en vivo"
            titulo="Vehículos por tipo y toneladas"
            accion={
              <button type="button" onClick={() => irAModulo("Control de Toneladas")} className="inline-flex items-center gap-1 text-[13px] font-semibold text-acento hover:underline">
                Control de toneladas <ArrowRight className="h-3.5 w-3.5" />
              </button>
            }
          >
            {!oh.disponible ? (
              <p className="text-sm text-atencion-fg">{oh.mensaje ?? "No se pudo leer la operación de hoy."}</p>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <BarrasTipo filas={oh.porTipoVehiculo} total={oh.vehiculosRegistrados} />
                  {despachoTexto && <p className="text-xs text-muted-foreground first-letter:uppercase">{despachoTexto}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-0.5 rounded-xl bg-muted/50 px-3.5 py-3">
                    <Eyebrow>Finalizados</Eyebrow>
                    <span className="lg-num text-2xl font-bold leading-tight">{NUM.format(oh.finalizadas)}</span>
                    <span className="lg-num text-xs text-muted-foreground">de {NUM.format(oh.ordenesHoy)} órdenes</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-xl bg-muted/50 px-3.5 py-3">
                    <Eyebrow>Tiempo promedio</Eyebrow>
                    <span className="lg-num text-2xl font-bold leading-tight">{oh.tiempoPromMin != null ? <>{oh.tiempoPromMin} <span className="text-sm font-medium text-muted-foreground">min</span></> : "—"}</span>
                    <span className="text-xs text-muted-foreground">histórico por operación</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-xl bg-muted/50 px-3.5 py-3">
                    <Eyebrow>Auxiliares con tonelaje</Eyebrow>
                    <span className="lg-num text-2xl font-bold leading-tight">{NUM.format(oh.auxiliares.length)}</span>
                    <span className="lg-num text-xs text-muted-foreground">{oh.auxiliares.length > 0 ? `promedio ${T1.format(promAux)} t cada uno` : "sin órdenes cerradas aún"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded-xl bg-muted/50 px-3.5 py-3">
                    <Eyebrow>Por unidad</Eyebrow>
                    <span className="lg-num text-2xl font-bold leading-tight">{NUM.format(oh.porUnidad.ordenes)}</span>
                    <span className="lg-num text-xs text-muted-foreground">{oh.porUnidad.ordenes > 0 ? `${NUM.format(oh.porUnidad.unidades)} unidades · no suman toneladas` : "huevos / empaque · aparte"}</span>
                  </div>
                </div>
              </div>
            )}
            {oh.disponible && oh.auxiliares.length > 0 && (
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-border pt-4 text-xs sm:grid-cols-2">
                <div>
                  <Eyebrow className="mb-1.5">Más toneladas</Eyebrow>
                  {oh.auxiliares.slice(0, 3).map((a) => (
                    <p key={a.persona} className="flex justify-between gap-2 py-0.5">
                      <span className="truncate">{a.persona}</span>
                      <span className="lg-num shrink-0 font-semibold">{T1.format(a.ton)} t</span>
                    </p>
                  ))}
                </div>
                {oh.auxiliares.length > 3 && (
                  <div>
                    <Eyebrow className="mb-1.5">Menos toneladas</Eyebrow>
                    {oh.auxiliares.slice(-3).reverse().map((a) => (
                      <p key={a.persona} className="flex justify-between gap-2 py-0.5">
                        <span className="truncate">{a.persona}</span>
                        <span className="lg-num shrink-0 font-semibold text-atencion-fg">{T1.format(a.ton)} t</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Seccion>

          <Seccion
            eyebrow="Personal"
            titulo="Cobertura de hoy por turno"
            accion={
              <span className="text-xs text-muted-foreground">
                Quincena {d.quincena.etiqueta}: <span className="lg-num font-semibold text-foreground">{NUM.format(d.cobertura.cubiertos)}</span> de {NUM.format(d.cobertura.programados)} turnos cubiertos
              </span>
            }
          >
            {d.hoy.turnos.length === 0 ? (
              <EstadoVacio titulo="No hay turnos programados para hoy" texto="Prográmalos en Personal del día › Programación de turnos." accion={<Button size="sm" variant="outline" onClick={() => irAModulo("Programación de turnos")}>Programar turnos</Button>} />
            ) : (
              <div className="flex flex-wrap gap-3">
                {d.hoy.turnos.map((t) => (
                  <TarjetaTurno key={t.etiqueta} t={t} />
                ))}
                <div className="flex min-w-[150px] flex-1 flex-col gap-1.5 rounded-xl border border-border px-3.5 py-3">
                  <span className="self-start rounded-md bg-acento px-1.5 py-0.5 text-[10px] font-semibold text-white">Total</span>
                  <p className="lg-num text-2xl font-bold leading-none">
                    {d.hoy.total.presentes}
                    <span className="text-sm font-normal text-muted-foreground"> / {d.hoy.total.programados}</span>
                  </p>
                  <Progreso pct={pctPersonal ?? 0} tono={pctPersonal != null && pctPersonal < 95 ? "atencion" : undefined} />
                  <p className="lg-num text-[11px] text-muted-foreground">
                    {d.novedadesAbiertas > 0 ? `${d.novedadesAbiertas} novedad${d.novedadesAbiertas === 1 ? "" : "es"} abierta${d.novedadesAbiertas === 1 ? "" : "s"}` : "sin novedades abiertas"}
                  </p>
                </div>
              </div>
            )}
          </Seccion>
        </div>

        {/* ===== Columna derecha ===== */}
        <div className="flex flex-col gap-4">
          {d.cierre.programacionManana.usa && (
            <Seccion
              eyebrow="Para mañana"
              titulo="Programación del cliente"
              accion={
                d.cierre.programacionManana.recibida ? (
                  <Chip tono={d.cierre.programacionManana.aTiempo === false ? "atencion" : "ok"}>
                    {d.cierre.programacionManana.programados} vehículo{d.cierre.programacionManana.programados === 1 ? "" : "s"} · {d.cierre.programacionManana.aTiempo === false ? "tarde" : "a tiempo"}
                  </Chip>
                ) : (
                  <Chip tono="atencion">Sin consignar · límite 5:00 p. m.</Chip>
                )
              }
            >
              <div className="flex flex-col gap-3">
                {d.cierre.programacionManana.recibida ? (
                  <p className="text-sm text-foreground/80">
                    Consignada{d.cierre.programacionManana.enviadaEn ? ` a las ${horaCorta(d.cierre.programacionManana.enviadaEn)}` : ""}
                    {d.cierre.programacionManana.enviadaPorUsuario ? ` por ${d.cierre.programacionManana.enviadaPorUsuario}` : ""}. Con ella se planea el personal de mañana y se medirá el cumplimiento.
                  </p>
                ) : (
                  <p className="text-sm text-foreground/80">El cliente aún no envía la programación de mañana. Cuando llegue por WhatsApp o Excel, consígnala aquí; con ella se planea el personal y se mide el cumplimiento.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" className="gap-1.5" onClick={() => irAModulo("Consignar programación del cliente")}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    {d.cierre.programacionManana.recibida ? "Ver o corregir" : "Consignar programación"}
                  </Button>
                </div>
                {prog.tiene && (
                  <div className="border-t border-dashed border-border pt-3">
                    <Eyebrow className="mb-1.5">Hoy se cumplió</Eyebrow>
                    <p className="lg-num text-sm">
                      <span className="font-semibold">{prog.cumplidos} de {prog.programados}</span> programados llegaron
                      {prog.porcentaje != null ? ` · ${NUM.format(prog.porcentaje)} %` : ""}
                      {prog.llegaron - prog.cumplidos > 0 ? ` · ${prog.llegaron - prog.cumplidos} fuera de programación` : ""}
                    </p>
                  </div>
                )}
              </div>
            </Seccion>
          )}

          <Seccion
            eyebrow="Antes de irte"
            titulo="Cierre del día"
            accion={<Chip tono={listos === puntosCierre.length ? "ok" : "neutro"}>{listos === puntosCierre.length ? "Listo para cerrar" : `${listos} de ${puntosCierre.length}`}</Chip>}
            sinPadding
          >
            <ul className="divide-y divide-border py-1">
              <ItemCierre
                ok={d.cierre.vehiculosSinCerrar === 0}
                texto="Vehículos cerrados"
                pendiente={`${d.cierre.vehiculosSinCerrar} iniciado${d.cierre.vehiculosSinCerrar === 1 ? "" : "s"} sin finalizar${oh.sinCerrarDetalle.masAntiguoMin != null ? ` · el más antiguo lleva ${duracion(oh.sinCerrarDetalle.masAntiguoMin)}` : ""}`}
                modulo="Centro de Coordinación"
                boton="Cerrar"
              />
              <ItemCierre
                ok={d.cierre.sinMarcar === 0}
                texto="Asistencia completa"
                pendiente={`${d.cierre.sinMarcar} persona${d.cierre.sinMarcar === 1 ? "" : "s"} sin marcar`}
                modulo="Tabla Asistencia"
                boton="Revisar"
              />
              <ItemCierre
                ok={d.cierre.turnosPorAprobar === 0}
                texto="Turnos y horas extra aprobados"
                pendiente={`${d.cierre.turnosPorAprobar} solicitud${d.cierre.turnosPorAprobar === 1 ? "" : "es"} por aprobar`}
                modulo="Aprobar Turnos"
                boton="Aprobar"
              />
              {d.cierre.programacionManana.usa && (
                <ItemCierre
                  ok={d.cierre.programacionManana.recibida}
                  texto={`Programación del cliente para mañana consignada${d.cierre.programacionManana.recibida ? ` (${d.cierre.programacionManana.programados} vehículo${d.cierre.programacionManana.programados === 1 ? "" : "s"}${d.cierre.programacionManana.aTiempo === false ? ", tarde" : ""})` : ""}`}
                  pendiente="Aún no llega la programación de mañana: pídesela al cliente y consígnala"
                  modulo="Consignar programación del cliente"
                  boton="Consignar"
                />
              )}
              <ItemCierre ok={d.cierre.bitacoraHoy} texto="Bitácora del día escrita" pendiente="Aún no hay anotación de hoy">
                <div className="flex gap-2">
                  <textarea
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    rows={2}
                    placeholder="Anota aquí las novedades del turno: incidentes, vehículos pendientes, personal…"
                    className="min-h-[52px] flex-1 rounded-[10px] border border-input bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <Button size="sm" className="h-auto self-stretch" disabled={!nota.trim() || guardandoNota} onClick={guardarNota}>
                    {guardandoNota ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                  </Button>
                </div>
                {errorNota && <p className="mt-1 text-[11px] text-critico-fg">{errorNota}</p>}
                <p className="mt-1 text-[10.5px] text-muted-foreground">Queda registrada en Bitácora con la fecha de hoy.</p>
              </ItemCierre>
            </ul>
            <div className="border-t border-border px-4 py-2.5 sm:px-5">
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => irAModulo("Bitácora")}>
                <Printer className="h-3.5 w-3.5" />
                Generar cierre del día (PDF)
              </Button>
              <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <ClipboardCheck className="h-3 w-3" /> El PDF sale de la pestaña Cierre del día en Bitácora.
              </p>
            </div>
          </Seccion>

          <Seccion
            eyebrow="Personal"
            titulo="Solicitar personal"
            accion={
              <Button size="sm" className="gap-1.5" onClick={() => irAModulo("Solicitud de Personal")}>
                <UserPlus className="h-3.5 w-3.5" />
                Nueva solicitud
              </Button>
            }
            sinPadding
          >
            {d.requisiciones.length === 0 ? (
              <EstadoVacio titulo="Sin solicitudes de personal en curso" texto="Cargo, puesto y turno salen del catálogo; la aprobación es doble (RRHH y Operaciones)." />
            ) : (
              <ul className="divide-y divide-border">
                {d.requisiciones.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <span className="lg-num shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                      {r.aprobadas}/{r.totalPasos}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.cargo}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.vacantes > 0 ? `${r.vacantes} ${r.vacantes === 1 ? "vacante" : "vacantes"}` : "Sin cupo definido"}
                        {r.proyecto ? ` · ${r.proyecto}` : ""} · {r.avance}
                      </p>
                    </div>
                    <Chip tono={r.estado === "aprobado" ? "ok" : r.estado === "rechazado" ? "critico" : "atencion"}>{r.estado}</Chip>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border px-4 py-2 sm:px-5">
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => irAModulo("Solicitud de Personal")}>
                Ver todas las solicitudes <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </Seccion>

          {oh.disponible && (
            <button
              type="button"
              onClick={() => irAModulo("Centro de Coordinación")}
              className="lg-card flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent sm:px-5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-acento-tinte text-acento">
                <Truck className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Centro de Coordinación</span>
                <span className="block text-xs text-muted-foreground">Muelles, órdenes en curso y cierre de vehículos</span>
              </span>
              <Scale className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default OperacionDelDia
