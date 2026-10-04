"use client"

// MARCACIONES DEL DÍA — acompaña a la tablet de portería.
//
// Todo sale del cruce entre la marcación real (`asistencia`) y el turno
// programado (`registroasistencia`). Nada se estima: si alguien no tiene turno
// programado, se dice, en vez de asumirle una hora de entrada.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { supabase } from "@/lib/supabase"
import { AlertTriangle, CheckCircle2, Clock, Loader2, Radio, UserX } from "lucide-react"
import { getMarcacionesDia } from "@/lib/marcaciones-dia-actions"
import type { MarcacionDia, MarcacionesDiaData } from "@/lib/marcaciones-dia-tipos"

function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?"
}

function Tarjeta({
  titulo, valor, pie, color,
}: {
  titulo: string
  valor: string | number
  pie: string
  color?: string
}) {
  return (
    <div className="flex-1 lg-card p-3">
      <p className="lg-eyebrow">{titulo}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {valor}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{pie}</p>
    </div>
  )
}

function Fila({ m }: { m: MarcacionDia }) {
  const detalle = [
    m.turno != null ? `T${m.turno}` : null,
    m.horaProgramada,
    m.puesto,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
        {iniciales(m.nombre || m.identificacion)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{m.nombre || m.identificacion}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {detalle || "sin turno programado"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm tabular-nums">
          {m.hora ?? <span className="text-muted-foreground">—</span>}
        </p>
        <p
          className="text-[11px] font-medium"
          style={{
            color:
              m.estado === "tarde" ? "#ea580c"
              : m.estado === "no_presentado" ? "#dc2626"
              : m.estado === "a_tiempo" ? "#059669"
              : "#64748b",
          }}
        >
          {m.estado === "a_tiempo" && "A tiempo"}
          {m.estado === "tarde" && `Tarde ${m.minutosTarde} min`}
          {m.estado === "no_presentado" && "No presentado"}
          {m.estado === "sin_turno" && (m.novedad ? "Con novedad" : "Sin turno")}
        </p>
      </div>
    </li>
  )
}

export function MarcacionesDelDia() {
  const { selectedEmpresaId } = useAuth()
  const [data, setData] = useState<MarcacionesDiaData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [enVivo, setEnVivo] = useState(false)

  const cargar = useCallback(async () => {
    const r = await getMarcacionesDia(selectedEmpresaId ?? null)
    if (r.success && r.data) setData(r.data)
    setCargando(false)
  }, [selectedEmpresaId])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Tiempo real sobre la tabla del kiosco: cada marcación refresca el panel sin
  // que nadie recargue la tablet. Canal propio para no chocar con otros módulos.
  useEffect(() => {
    const canal = supabase
      .channel("marcaciones-porteria")
      .on("postgres_changes", { event: "*", schema: "public", table: "asistencia" }, () => cargar())
      .subscribe((e: string) => setEnVivo(e === "SUBSCRIBED"))
    return () => {
      supabase.removeChannel(canal)
    }
  }, [cargar])

  if (cargando) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data) return null

  const r = data.resumen

  return (
    <div className="space-y-3">
      {data.avisos.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          {data.avisos.map((a) => (
            <p key={a} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {a}
            </p>
          ))}
        </div>
      )}

      {/* Las cuatro cifras del día */}
      <div className="flex flex-wrap gap-3">
        <Tarjeta
          titulo="Marcaciones hoy"
          valor={r.marcaron}
          pie={r.turnos.length ? `turnos ${r.turnos.join(" y ")}` : "sin turnos programados"}
        />
        <Tarjeta
          titulo="A tiempo"
          valor={r.aTiempo}
          color="#059669"
          pie={r.pctCumplimiento != null ? `${r.pctCumplimiento}% de cumplimiento` : "sin turnos con hora"}
        />
        <Tarjeta
          titulo="Llegadas tarde"
          valor={r.tarde}
          color={r.tarde > 0 ? "#ea580c" : undefined}
          pie={r.tarde > 0 ? "quedan registradas en la asistencia" : "ninguna hoy"}
        />
        <Tarjeta
          titulo="No presentados"
          valor={r.noPresentados}
          color={r.noPresentados > 0 ? "#dc2626" : undefined}
          pie={
            r.noPresentados > 0
              ? "tenían turno y no marcaron"
              : r.conNovedad > 0
                ? `${r.conNovedad} con novedad justificada`
                : "nadie faltó"
          }
        />
      </div>

      {/* El detalle */}
      <section className="lg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h3 className="text-sm font-semibold">Marcaciones de hoy</h3>
          {enVivo && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
              <Radio className="h-3 w-3" />
              en vivo
            </span>
          )}
        </div>
        {data.marcaciones.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Todavía no hay marcaciones ni turnos programados para hoy.
          </p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {data.marcaciones.map((m) => (
              <Fila key={`${m.identificacion}-${m.turno ?? "u"}`} m={m} />
            ))}
          </ul>
        )}
      </section>

      {/* Lo que el sistema hace solo con estas diferencias */}
      <section className="lg-card p-4">
        <h3 className="text-sm font-semibold">Qué pasa con estas diferencias</h3>
        <ul className="mt-2 space-y-1.5 text-xs">
          {r.tarde > 0 && (
            <li className="flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600" />
              <span>
                <strong>{r.tarde}</strong> llegada{r.tarde === 1 ? "" : "s"} tarde. La hora real queda
                guardada y se ve en Tabla Asistencia.
              </span>
            </li>
          )}
          {r.noPresentados > 0 && (
            <li className="flex items-start gap-2">
              <UserX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
              <span>
                <strong>{r.noPresentados}</strong> sin marcar. Hay que registrarles la novedad en
                Novedades de personal, o el día queda sin explicación en la nómina.
              </span>
            </li>
          )}
          {r.conNovedad > 0 && (
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span>
                <strong>{r.conNovedad}</strong> ausencia{r.conNovedad === 1 ? "" : "s"} ya
                justificada{r.conNovedad === 1 ? "" : "s"} con novedad.
              </span>
            </li>
          )}
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>
              Las horas extra no se generan por marcar fuera del turno: se calculan aparte y
              requieren aprobación.
            </span>
          </li>
        </ul>
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          La llegada tarde se mide contra la hora de entrada programada. A quien no tiene turno
          programado no se le calcula tardanza.
        </p>
      </section>
    </div>
  )
}

export default MarcacionesDelDia
