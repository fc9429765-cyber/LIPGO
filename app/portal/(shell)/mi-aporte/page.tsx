"use client"

// Portal del Trabajador → "Mi aporte a las metas de LIP".
// Vista INDIVIDUAL: cada trabajador entra con su cédula y solo ve SU info.
// (1) Tarjetas por área: mi resultado vs meta + semáforo + mensaje claro.
// (2) Mis metas asignadas (sig_metas_colaborador).
// (3) Línea de tiempo: mis logros e incumplimientos (incapacidades, cursos, SLA).
// Todo calculado en vivo desde LIPgo, filtrado por el colaborador autenticado.

import { useEffect, useState } from "react"
import { usePortal } from "@/components/portal/portal-provider"
import { getMiAporteObjetivos } from "@/lib/portal-objetivos-actions"
import type { MiAporte } from "@/lib/portal-objetivos"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Target, Loader2, CheckCircle2, AlertTriangle, Circle, HeartPulse, Truck, GraduationCap, Package, Award } from "lucide-react"

const C: Record<string, string> = { ok: "#16a34a", warn: "#f59e0b", bad: "#dc2626", info: "#64748b" }
const ESTADO_TXT: Record<string, string> = { ok: "En meta", warn: "Cerca", bad: "Atención", info: "Informativo" }
const AREA_ICON: Record<string, any> = { SST: HeartPulse, Operación: Truck, Formación: GraduationCap, Productividad: Package, Desempeño: Award }

function fFecha(iso?: string | null) {
  if (!iso) return ""
  const [y, m, d] = String(iso).split("T")[0].split("-")
  return y && m && d ? `${d}/${m}/${y}` : String(iso)
}

export default function MiAportePage() {
  const { colaborador } = usePortal()
  const [data, setData] = useState<MiAporte | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!colaborador) return
    let cancel = false
    setLoading(true)
    getMiAporteObjetivos({
      identificacion: colaborador.identificacion,
      nombre: colaborador.nombre,
      colaboradorId: colaborador.colaborador_id,
      idempresa: colaborador.idempresa ?? null,
    })
      .then((r) => {
        if (cancel) return
        if (r.success && r.data) setData(r.data)
      })
      .finally(() => !cancel && setLoading(false))
    return () => {
      cancel = true
    }
  }, [colaborador])

  if (!colaborador) return null

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Target className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Así contribuyes a las metas de LIP</CardTitle>
              <CardDescription>
                {colaborador.nombre} · tu aporte de {data?.periodoLabel ?? "este periodo"}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : !data ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No pudimos cargar tu aporte.</p>
      ) : (
        <>
          {/* (0) Puntaje de compromiso — inspirador */}
          <Card className="overflow-hidden border-0 text-white shadow-md" style={{ background: `linear-gradient(120deg, #0A2540 0%, #0D3B6E 50%, ${C[data.nivel.color]} 140%)` }}>
            <CardContent className="flex flex-col items-center gap-2 p-5 text-center sm:flex-row sm:gap-5 sm:text-left">
              <div className="flex flex-col items-center">
                <span className="text-5xl font-bold leading-none">{data.puntajeCompromiso}%</span>
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-white/80">Mi compromiso</span>
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold">{data.nivel.emoji} {data.nivel.nombre}</p>
                <p className="text-sm text-white/90">{data.nivel.mensaje}</p>
              </div>
            </CardContent>
          </Card>

          {/* (0.5) Qué hacer para mejorar */}
          {data.accionesMejora.length > 0 && (
            <Card className="border-amber-300 bg-amber-50/60">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base" style={{ color: C.warn }}>
                  <AlertTriangle className="h-4 w-4" /> Qué puedes hacer para mejorar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {data.accionesMejora.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.warn }} />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* (1) Tarjetas por área */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.tarjetas.map((t) => {
              const Icon = AREA_ICON[t.area] || Target
              return (
                <Card key={t.label} className="relative overflow-hidden">
                  <div className="absolute inset-x-0 top-0 h-1" style={{ background: C[t.estado] }} />
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.area}</span>
                      <span className="rounded-lg p-1.5" style={{ background: `${C[t.estado]}14` }}>
                        <Icon className="h-4 w-4" style={{ color: C[t.estado] }} />
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground">{t.label}</p>
                    <div className="mt-1 flex items-end gap-1.5">
                      <span className="text-2xl font-bold leading-none" style={{ color: C[t.estado] }}>
                        {t.valor.toLocaleString("es-CO")}
                      </span>
                      <span className="mb-0.5 text-xs font-medium text-muted-foreground">{t.unidad}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      {t.meta != null && (
                        <span className="text-[11px] text-muted-foreground">
                          Meta {t.sentido === "menor_mejor" ? "≤" : "≥"} {t.meta}{t.unidad === "%" ? "%" : ` ${t.unidad}`}
                        </span>
                      )}
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: C[t.estado] }}>
                        {ESTADO_TXT[t.estado]}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t.mensaje}</p>
                    {t.impactoDesempeno && (
                      <p className="mt-1.5 flex items-center gap-1 text-[11px] font-medium" style={{ color: "#0D3B6E" }}>
                        <Award className="h-3 w-3" /> {t.impactoDesempeno}
                      </p>
                    )}
                    {t.consejo && (
                      <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] leading-snug" style={{ color: "#92400e" }}>
                        💡 {t.consejo}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* (2) Metas asignadas */}
          {data.metas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mis metas asignadas</CardTitle>
                <CardDescription>Objetivos individuales definidos por tu coordinador / Gestión Humana</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.metas.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{m.indicador}</p>
                      <p className="text-[11px] text-muted-foreground">{m.area} {m.periodo ? `· ${m.periodo}` : ""}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{m.valor_actual ?? "—"} / {m.meta ?? "—"} {m.unidad}</p>
                      <p className="text-[11px] text-muted-foreground">{m.estado}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* (2.5) Conexión con la evaluación de desempeño */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-4 w-4" style={{ color: "#0D3B6E" }} /> Tu evaluación de desempeño
              </CardTitle>
              <CardDescription>Tu día a día (asistencia, SLA y formación) es lo que se evalúa. Cuídalo y tu evaluación sube.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.desempeno ? (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div>
                    <p className="lg-eyebrow">Puntaje</p>
                    <p className="text-2xl font-bold" style={{ color: "#0D3B6E" }}>{data.desempeno.puntaje}</p>
                  </div>
                  <div>
                    <p className="lg-eyebrow">Riesgo</p>
                    <p className="text-2xl font-bold" style={{ color: data.desempeno.riesgo <= 30 ? C.ok : data.desempeno.riesgo <= 60 ? C.warn : C.bad }}>
                      {data.desempeno.riesgo}%
                    </p>
                  </div>
                  {data.desempeno.decision && (
                    <div>
                      <p className="lg-eyebrow">Sugerencia</p>
                      <p className="text-sm font-semibold capitalize">{data.desempeno.decision}</p>
                    </div>
                  )}
                  {data.desempeno.fecha && (
                    <div className="ml-auto text-[11px] text-muted-foreground">Evaluado: {fFecha(data.desempeno.fecha)}</div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Aún no tienes una evaluación de desempeño registrada. ¡Mantén tus indicadores en verde para tu primera evaluación!</p>
              )}
            </CardContent>
          </Card>

          {/* (3) Línea de tiempo: logros e incumplimientos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mis logros e incumplimientos</CardTitle>
              <CardDescription>Lo que suma y lo que debes mejorar, según tu registro en LIPgo</CardDescription>
            </CardHeader>
            <CardContent>
              {data.timeline.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin novedades en el periodo. ¡Bien hecho! 🎉</p>
              ) : (
                <ul className="space-y-2">
                  {data.timeline.map((e, i) => {
                    const Icon = e.signo === "ok" ? CheckCircle2 : e.signo === "bad" ? AlertTriangle : Circle
                    const col = e.signo === "ok" ? C.ok : e.signo === "bad" ? C.bad : C.info
                    return (
                      <li key={i} className="flex items-start gap-3 rounded-lg border p-2.5">
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: col }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm">{e.texto}</p>
                          {e.fecha && <p className="text-[11px] text-muted-foreground">{fFecha(e.fecha)}</p>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
