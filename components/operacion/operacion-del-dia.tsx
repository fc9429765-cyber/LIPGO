"use client"

// OPERACIÓN DEL DÍA — panel ejecutivo del coordinador.
//
// Reúne en una pantalla lo que hoy está repartido: personal activo, turnos,
// cobertura, novedades pendientes, solicitudes de personal y el pago de la
// quincena. Todo filtrado por la empresa del selector global.
//
// Cada cifra sale de la misma fuente que ya usa su módulo: no se recalcula
// nada por una vía propia. Los botones llevan al módulo donde se resuelve.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  ArrowRight,
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

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})
const NUM = new Intl.NumberFormat("es-CO")

/** Abre otro módulo. El destino conserva su propio PermissionGuard. */
function irAModulo(nombre: string) {
  window.dispatchEvent(new CustomEvent("lipgo:navigate-module", { detail: nombre }))
}

const COLOR_NIVEL: Record<ItemBandeja["nivel"], string> = {
  alto: "#dc2626",
  medio: "#f59e0b",
  bajo: "#16a34a",
}
const T1 = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 })

/** Cifra compacta de la tarjeta "Vehículos y toneladas de hoy". */
function Cifra({ label, valor, sub, color }: { label: string; valor: string | number; sub: string; color?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums" style={{ color }}>{valor}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

/** Renglón de la lista de cierre: en verde cuando está en cero. `children` = acción en línea (p. ej. anotar la bitácora). */
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
    <li className="px-4 py-2">
      <div className="flex items-center gap-3">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <span className="h-4 w-4 shrink-0 rounded-full border-2 border-amber-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${ok ? "text-muted-foreground line-through decoration-muted-foreground/40" : "font-medium"}`}>{texto}</p>
          {!ok && <p className="text-[11px] text-amber-700">{pendiente}</p>}
        </div>
        {!ok && modulo && boton && (
          <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={() => irAModulo(modulo)}>
            {boton}
          </Button>
        )}
      </div>
      {!ok && children && <div className="mt-2 pl-7">{children}</div>}
    </li>
  )
}

/** El anillo de cobertura de la cabecera. */
function Anillo({ pct }: { pct: number }) {
  const r = 34
  const circ = 2 * Math.PI * r
  const lleno = Math.max(0, Math.min(100, pct))
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none"
          stroke="#5eead4" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(circ * lleno) / 100} ${circ}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold text-white tabular-nums">{lleno}%</span>
        <span className="text-[9px] uppercase tracking-wide text-white/70">cobertura</span>
      </div>
    </div>
  )
}

function TarjetaTurno({ t }: { t: CoberturaTurno }) {
  const pct = t.programados > 0 ? Math.round((t.presentes / t.programados) * 100) : 0
  return (
    <div className="flex-1 border-r border-border px-4 py-3 last:border-r-0">
      <div className="flex items-center gap-2">
        <span className="rounded bg-foreground/85 px-1.5 py-0.5 font-mono text-[10px] text-background">
          {t.etiqueta}
        </span>
        {t.horario && <span className="font-mono text-[11px] text-muted-foreground">{t.horario}</span>}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">
        {t.presentes === 0 && t.programados === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span style={{ color: pct >= 95 ? undefined : "#f59e0b" }}>{t.presentes}</span>
        )}
        <span className="text-base font-normal text-muted-foreground"> / {t.programados}</span>
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded"
          style={{ width: `${pct}%`, background: pct >= 95 ? "#14b8a6" : "#f59e0b" }}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t.programados === 0
          ? "sin turnos programados"
          : t.sinMarcar > 0
            ? `${t.sinMarcar} sin marcar`
            : `${pct}% de asistencia confirmada`}
      </p>
    </div>
  )
}

export function OperacionDelDia() {
  const { selectedEmpresaId } = useAuth()
  const [data, setData] = useState<OperacionDiaData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Anotación rápida de la bitácora desde el cierre del día (misma acción que
  // usa el módulo Bitácora; no se recalcula nada aquí).
  const [nota, setNota] = useState("")
  const [guardandoNota, setGuardandoNota] = useState(false)
  const [errorNota, setErrorNota] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await getOperacionDia(selectedEmpresaId ?? null)
    if (r.success && r.data) setData(r.data)
    else {
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
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Operación</p>
          <h1 className="text-xl font-semibold">Operación del día</h1>
        </div>
        <Button variant="outline" size="sm" onClick={cargar} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Actualizar
        </Button>
      </div>

      {/* Avisos de datos que no se pudieron leer: nunca mostrar 0 como si fuera real. */}
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

      {/* CABECERA — HOY: vehículos, toneladas y cobertura del día (la quincena
          queda como referencia al pie; el panel es del día, no del pago). */}
      <section
        className="rounded-xl p-5 text-white"
        style={{ background: "linear-gradient(120deg, #0f3b3b, #0a5757 60%, #0d6b6b)" }}
      >
        <div className="flex flex-wrap items-center gap-5">
          <Anillo
            pct={
              d.hoy.total.programados > 0
                ? Math.round((d.hoy.total.presentes / d.hoy.total.programados) * 100)
                : 0
            }
          />

          <div className="min-w-[220px] flex-1">
            <p className="text-[10px] uppercase tracking-wide text-white/60">Hoy · {d.fecha}</p>
            <h2 className="text-2xl font-semibold tabular-nums">
              {d.operacionHoy.disponible ? (
                <>
                  {NUM.format(d.operacionHoy.ordenesHoy)} vehículo{d.operacionHoy.ordenesHoy === 1 ? "" : "s"} ·{" "}
                  {T1.format(d.operacionHoy.toneladas)} t
                </>
              ) : (
                "Operación del día"
              )}
            </h2>
            <p className="mt-1 text-sm text-white/80">
              {d.operacionHoy.disponible
                ? `${NUM.format(d.operacionHoy.finalizadas)} finalizados · ${NUM.format(d.operacionHoy.sinCerrar)} sin cerrar${
                    d.operacionHoy.metaTonDia > 0 ? ` · meta ${T1.format(d.operacionHoy.metaTonDia)} t` : ""
                  }`
                : "No se pudo leer la operación de hoy."}
            </p>
            <p className="mt-0.5 text-xs text-white/55">
              {d.hoy.total.programados > 0
                ? `${d.hoy.total.presentes} de ${d.hoy.total.programados} personas en operación`
                : "Sin turnos programados para hoy"}
              {" · "}quincena {d.quincena.etiqueta}: {NUM.format(d.cobertura.cubiertos)} de {NUM.format(d.cobertura.programados)} turnos cubiertos
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            <div className="border-l border-white/20 pl-5">
              <p className="text-[10px] uppercase tracking-wide text-white/60">En patio</p>
              <p
                className="text-2xl font-semibold tabular-nums"
                style={{ color: d.operacionHoy.enPatio > 3 ? "#fbbf24" : undefined }}
              >
                {NUM.format(d.operacionHoy.enPatio)}
              </p>
              <p className="text-[11px] text-white/55">{d.operacionHoy.enPatio ? "esperan ingreso" : "nadie en espera"}</p>
            </div>
            <div className="border-l border-white/20 pl-5">
              <p className="text-[10px] uppercase tracking-wide text-white/60">Personal activo</p>
              <p className="text-2xl font-semibold tabular-nums">{NUM.format(d.personalActivo)}</p>
              <p className="text-[11px] text-white/55">operativos en la planta</p>
            </div>
            <div className="border-l border-white/20 pl-5">
              <p className="text-[10px] uppercase tracking-wide text-white/60">Novedades abiertas</p>
              <p
                className="text-2xl font-semibold tabular-nums"
                style={{ color: d.novedadesAbiertas > 0 ? "#fbbf24" : undefined }}
              >
                {NUM.format(d.novedadesAbiertas)}
              </p>
              <p className="text-[11px] text-white/55">
                {d.novedadesAbiertas > 0 ? "esperan gestión" : "todo al día"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COBERTURA DE HOY */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Operación en vivo
            </p>
            <h2 className="text-sm font-semibold">Cobertura de hoy</h2>
            <p className="text-[11px] text-muted-foreground">
              Programado por ti · marcado en la tablet de portería
            </p>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground">{d.fecha}</span>
        </div>

        {d.hoy.turnos.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No hay turnos programados para hoy.
          </p>
        ) : (
          <div className="flex flex-wrap">
            {d.hoy.turnos.map((t) => (
              <TarjetaTurno key={t.etiqueta} t={t} />
            ))}
            <div className="flex-1 bg-muted/30 px-4 py-3">
              <span className="rounded bg-foreground/85 px-1.5 py-0.5 font-mono text-[10px] text-background">
                Total
              </span>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums">
                {d.hoy.total.presentes}
                <span className="text-base font-normal text-muted-foreground">
                  {" "}/ {d.hoy.total.programados}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">personas en operación</p>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
        {/* BANDEJA DEL DÍA */}
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Bandeja del día
            </p>
            <h2 className="text-sm font-semibold">Requiere tu atención</h2>
          </div>
          {d.bandeja.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nada pendiente. La operación está al día.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {d.bandeja.map((it) => (
                <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: COLOR_NIVEL[it.nivel] }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{it.titulo}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{it.detalle}</p>
                  </div>
                  {it.moduloDestino && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => irAModulo(it.moduloDestino!)}
                    >
                      {it.textoBoton ?? "Abrir"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* CIERRE DEL DÍA — lo que debe quedar en cero antes de irse. Va bajo la
            bandeja (el espacio que quedaba en blanco) y permite anotar la
            bitácora de hoy sin salir del panel. */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Antes de irte</p>
              <h2 className="text-sm font-semibold">Cierre del día</h2>
            </div>
            {(() => {
              // Los ausentismos en borrador se acumulan de días anteriores y
              // ya salen en la Bandeja; aquí solo va lo que cierra HOY.
              const pend =
                (d.cierre.vehiculosSinCerrar > 0 ? 1 : 0) +
                (d.cierre.sinMarcar > 0 ? 1 : 0) +
                (d.cierre.turnosPorAprobar > 0 ? 1 : 0) +
                (d.cierre.bitacoraHoy ? 0 : 1)
              return (
                <span
                  className="rounded px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: pend === 0 ? "#dcfce7" : "#fef3c7", color: pend === 0 ? "#166534" : "#92400e" }}
                >
                  {pend === 0 ? "Listo para cerrar" : `${pend} pendiente${pend === 1 ? "" : "s"}`}
                </span>
              )
            })()}
          </div>
          <ul className="divide-y divide-border">
            <ItemCierre
              ok={d.cierre.vehiculosSinCerrar === 0}
              texto="Vehículos cerrados"
              pendiente={`${d.cierre.vehiculosSinCerrar} iniciado${d.cierre.vehiculosSinCerrar === 1 ? "" : "s"} sin finalizar`}
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
                texto={`Programación del cliente para mañana recibida (${d.cierre.programacionManana.programados} vehículo${d.cierre.programacionManana.programados === 1 ? "" : "s"}${d.cierre.programacionManana.aTiempo === false ? ", tarde" : ""})`}
                pendiente="Aún no llega la programación de mañana: pídesela al cliente y consígnala"
                modulo="Consignar programación del cliente"
                boton="Consignar programación"
              />
            )}
            <ItemCierre ok={d.cierre.bitacoraHoy} texto="Bitácora del día escrita" pendiente="Aún no hay anotación de hoy">
              <div className="flex gap-2">
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  rows={2}
                  placeholder="Anota aquí las novedades del turno: incidentes, vehículos pendientes, personal…"
                  className="min-h-[52px] flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button size="sm" className="h-auto self-stretch" disabled={!nota.trim() || guardandoNota} onClick={guardarNota}>
                  {guardandoNota ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                </Button>
              </div>
              {errorNota && <p className="mt-1 text-[11px] text-red-700">{errorNota}</p>}
              <p className="mt-1 text-[10.5px] text-muted-foreground">Queda registrada en Bitácora con la fecha de hoy.</p>
            </ItemCierre>
          </ul>
          <div className="border-t border-border px-4 py-2.5">
            <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => irAModulo("Bitácora")}>
              <Printer className="h-3.5 w-3.5" />
              Generar cierre del día (PDF)
            </Button>
            <p className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
              <ClipboardCheck className="h-3 w-3" /> El PDF sale de la pestaña Cierre del día en Bitácora.
            </p>
          </div>
        </section>
        </div>

        <div className="space-y-4">
          {/* SOLICITAR PERSONAL */}
          <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Personal</p>
                <h2 className="text-sm font-semibold">Solicitar personal</h2>
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => irAModulo("Solicitud de Personal")}>
                <UserPlus className="h-3.5 w-3.5" />
                Nueva requisición
              </Button>
            </div>

            {d.requisiciones.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No hay solicitudes de personal registradas.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {d.requisiciones.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      {r.aprobadas}/{r.totalPasos}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.cargo}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.vacantes > 0 ? `${r.vacantes} ${r.vacantes === 1 ? "vacante" : "vacantes"}` : "Sin cupo definido"}
                        {r.proyecto ? ` · ${r.proyecto}` : ""} · {r.avance}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{
                        background:
                          r.estado === "aprobado" ? "#dcfce7" : r.estado === "rechazado" ? "#fee2e2" : "#fef3c7",
                        color:
                          r.estado === "aprobado" ? "#166534" : r.estado === "rechazado" ? "#991b1b" : "#92400e",
                      }}
                    >
                      {r.estado}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border px-4 py-2">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => irAModulo("Solicitud de Personal")}
              >
                Ver todas las solicitudes <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </section>

          {/* VEHÍCULOS Y TONELADAS DE HOY — el corazón del día del coordinador.
              (Reemplaza a la tarjeta de pago de la quincena, 2026-09-30.) */}
          <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Operación en vivo</p>
                <h2 className="text-sm font-semibold">Vehículos y toneladas de hoy</h2>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => irAModulo("Centro de Coordinación")}>
                <Truck className="h-3.5 w-3.5" />
                Centro de Coordinación
              </Button>
            </div>

            {!d.operacionHoy.disponible ? (
              <div className="m-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  No se pudo leer la operación de hoy
                </p>
                <p className="mt-1">{d.operacionHoy.mensaje}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">
                  <Cifra label="Vehículos hoy" valor={d.operacionHoy.ordenesHoy} sub={`${d.operacionHoy.finalizadas} finalizados`} />
                  <Cifra
                    label="Sin cerrar"
                    valor={d.operacionHoy.sinCerrar}
                    sub={d.operacionHoy.sinCerrar ? "iniciados sin finalizar" : "todo cerrado"}
                    color={d.operacionHoy.sinCerrar ? "#d97706" : "#0f766e"}
                  />
                  <Cifra
                    label="En patio"
                    valor={d.operacionHoy.enPatio}
                    sub={d.operacionHoy.enPatio ? "llegaron hoy, sin procesar" : "nadie en espera"}
                    color={d.operacionHoy.enPatio > 3 ? "#d97706" : undefined}
                  />
                  <Cifra
                    label="Tiempo promedio"
                    valor={d.operacionHoy.tiempoPromMin != null ? `${d.operacionHoy.tiempoPromMin} min` : "—"}
                    sub="promedio histórico por operación"
                  />
                </div>

                <div className="border-t border-border px-4 py-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Toneladas cerradas hoy</p>
                      <p className="text-2xl font-semibold tabular-nums">
                        {T1.format(d.operacionHoy.toneladas)}
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}t{d.operacionHoy.metaTonDia > 0 ? ` / ${T1.format(d.operacionHoy.metaTonDia)} t meta del día` : ""}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => irAModulo("Control de Toneladas")}
                    >
                      <Scale className="h-3.5 w-3.5" /> Control de toneladas <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  {d.operacionHoy.metaTonDia > 0 && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded"
                        style={{
                          width: `${Math.min(100, Math.round((d.operacionHoy.toneladas / d.operacionHoy.metaTonDia) * 100))}%`,
                          background: d.operacionHoy.toneladas >= d.operacionHoy.metaTonDia ? "#14b8a6" : "#f59e0b",
                        }}
                      />
                    </div>
                  )}

                  {d.operacionHoy.porUnidad.ordenes > 0 && (
                    <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                      <span className="font-semibold">Por unidad (huevos / empaque):</span>
                      <span>
                        {d.operacionHoy.porUnidad.ordenes} descargue{d.operacionHoy.porUnidad.ordenes === 1 ? "" : "s"} ·{" "}
                        {NUM.format(d.operacionHoy.porUnidad.unidades)} unidades
                      </span>
                      <span className="text-amber-700/80">aparte, no suman toneladas</span>
                    </p>
                  )}

                  {/* Programación del cliente para hoy (solo si la empresa la usa). */}
                  {d.operacionHoy.programacion.usa && (
                    <button
                      type="button"
                      onClick={() => irAModulo("Consignar programación del cliente")}
                      className={`mt-2 inline-flex flex-wrap items-center gap-x-2 rounded-md border px-2 py-1 text-left text-[11px] transition-colors ${
                        d.operacionHoy.programacion.tiene ? "border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100" : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"
                      }`}
                      title="Abrir Programación del cliente · cumplimiento"
                    >
                      <span className="font-semibold">Programación del cliente:</span>
                      {d.operacionHoy.programacion.tiene ? (
                        <span>
                          {d.operacionHoy.programacion.programados} programado{d.operacionHoy.programacion.programados === 1 ? "" : "s"} ·{" "}
                          {d.operacionHoy.programacion.llegaron} llegaron
                          {d.operacionHoy.programacion.porcentaje != null ? ` · ${d.operacionHoy.programacion.porcentaje} % cumplido` : ""}
                          {d.operacionHoy.programacion.aTiempo === false ? " · enviada tarde" : ""}
                        </span>
                      ) : (
                        <span>hoy no hubo programación del cliente · {d.operacionHoy.programacion.llegaron} llegaron sin programar</span>
                      )}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}

                  {d.operacionHoy.auxiliares.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Más toneladas</p>
                        {d.operacionHoy.auxiliares.slice(0, 3).map((a) => (
                          <p key={a.persona} className="flex justify-between gap-2">
                            <span className="truncate">{a.persona}</span>
                            <span className="shrink-0 tabular-nums font-medium">{T1.format(a.ton)} t</span>
                          </p>
                        ))}
                      </div>
                      {d.operacionHoy.auxiliares.length > 3 && (
                        <div>
                          <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Menos toneladas</p>
                          {d.operacionHoy.auxiliares.slice(-3).reverse().map((a) => (
                            <p key={a.persona} className="flex justify-between gap-2">
                              <span className="truncate">{a.persona}</span>
                              <span className="shrink-0 tabular-nums font-medium text-amber-700">{T1.format(a.ton)} t</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default OperacionDelDia
