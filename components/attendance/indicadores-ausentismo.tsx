"use client"

// INDICADORES DE AUSENTISMO — pestaña del Visor de Asistencia.
//
// Índice, días perdidos, costo y severidad del periodo, con el desglose por
// causa y las personas reincidentes.
//
// El índice usa el criterio canónico del Panel de Gestión Humana: días perdidos
// sobre días-persona VINCULADOS, no sobre filas de asistencia.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertTriangle, Info, Loader2 } from "lucide-react"
import { getIndicadoresAusentismo } from "@/lib/indicadores-ausentismo-actions"
import type { IndicadoresAusentismoData } from "@/lib/indicadores-ausentismo-tipos"

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})
const NUM = new Intl.NumberFormat("es-CO")

/** Meta de referencia. No está configurada en el sistema: se declara aquí. */
const META_INDICE = 3.5

function hoyColombia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function Tarjeta({
  titulo, valor, pie, color,
}: {
  titulo: string
  valor: string
  pie: string
  color?: string
}) {
  return (
    <div className="flex-1 lg-card p-4">
      <p className="lg-eyebrow">{titulo}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {valor}
      </p>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{pie}</p>
    </div>
  )
}

export function IndicadoresAusentismo() {
  const { selectedEmpresaId } = useAuth()

  const hoy = hoyColombia()
  const [desde, setDesde] = useState(`${hoy.slice(0, 8)}01`)
  const [hasta, setHasta] = useState(hoy)
  const [data, setData] = useState<IndicadoresAusentismoData | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await getIndicadoresAusentismo(selectedEmpresaId ?? null, desde, hasta)
    if (r.success && r.data) setData(r.data)
    else {
      setData(null)
      setError(r.message ?? "No se pudieron calcular los indicadores.")
    }
    setCargando(false)
  }, [selectedEmpresaId, desde, hasta])

  useEffect(() => {
    cargar()
  }, [cargar])

  return (
    <div className="space-y-4">
      {/* Rango */}
      <div className="flex flex-wrap items-end gap-2 lg-card p-3">
        <div>
          <Label className="text-xs">Desde</Label>
          <Input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className="mt-1 h-9 w-40 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Hasta</Label>
          <Input
            type="date"
            value={hasta}
            min={desde}
            onChange={(e) => setHasta(e.target.value)}
            className="mt-1 h-9 w-40 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={cargar} className="h-9">
          Actualizar
        </Button>
        {data && (
          <p className="ml-auto text-[11px] text-muted-foreground">{data.periodo.etiqueta}</p>
        )}
      </div>

      {cargando ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        </div>
      ) : (
        <>
          {data.avisos.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              {data.avisos.map((a) => (
                <p key={a} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {a}
                </p>
              ))}
            </div>
          )}

          {/* Las cuatro cifras */}
          <div className="flex flex-wrap gap-3">
            <Tarjeta
              titulo="Índice de ausentismo"
              valor={data.indice != null ? `${String(data.indice).replace(".", ",")}%` : "—"}
              color={
                data.indice == null ? undefined : data.indice > META_INDICE ? "#ea580c" : "#059669"
              }
              pie={
                data.indice == null
                  ? "sin días-persona para calcular"
                  : `meta menor a ${String(META_INDICE).replace(".", ",")}%`
              }
            />
            <Tarjeta
              titulo="Días perdidos"
              valor={NUM.format(data.diasPerdidos)}
              pie={`sobre ${NUM.format(data.diasEsperados)} días-persona vinculados`}
            />
            <Tarjeta
              titulo="Costo del ausentismo"
              valor={data.costo != null ? COP.format(data.costo) : "—"}
              color={data.costo != null && data.costo > 0 ? "#dc2626" : undefined}
              pie={
                data.costo == null
                  ? "sin salarios registrados"
                  : data.sinSalario > 0
                    ? `estimado sobre salario base · ${data.sinSalario} sin salario`
                    : "estimado sobre salario base"
              }
            />
            <Tarjeta
              titulo="Severidad promedio"
              valor={data.severidad != null ? `${String(data.severidad).replace(".", ",")} días` : "—"}
              color="#0284c7"
              pie={`por evento · ${NUM.format(data.eventos)} eventos`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Causas */}
            <section className="lg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Días perdidos por causa</h3>
              </div>
              {data.causas.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No hay ausentismo registrado en el periodo.
                </p>
              ) : (
                <div className="space-y-3 p-4">
                  {data.causas.map((c) => (
                    <div key={c.id}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{c.etiqueta}</span>
                        <span className="shrink-0 tabular-nums">
                          <strong>{NUM.format(c.dias)}</strong>{" "}
                          <span className="text-muted-foreground">
                            {c.dias === 1 ? "día" : "días"}
                          </span>
                          <span className="ml-2 text-xs text-muted-foreground">{c.pct}%</span>
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded"
                          style={{ width: `${c.pct}%`, background: c.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Reincidencia */}
            <section className="lg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Reincidencia por colaborador</h3>
                <p className="text-[11px] text-muted-foreground">
                  Más de un evento en el periodo.
                </p>
              </div>
              {data.reincidencia.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nadie tuvo más de un evento en el periodo.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border lg-eyebrow">
                        <th className="px-4 py-2 text-left font-medium">Colaborador</th>
                        <th className="px-2 py-2 text-right font-medium">Eventos</th>
                        <th className="px-2 py-2 text-right font-medium">Días</th>
                        <th className="px-4 py-2 text-left font-medium">Predominante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.reincidencia.map((p) => (
                        <tr key={p.identificacion} className="border-b border-border last:border-0">
                          <td className="px-4 py-2">
                            <p className="max-w-[180px] truncate">{p.nombre}</p>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.eventos}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{p.dias}</td>
                          <td className="px-4 py-2">
                            <span
                              className="inline-block max-w-[170px] truncate rounded px-1.5 py-0.5 text-[10px] text-white"
                              style={{ background: p.predominanteColor }}
                            >
                              {p.predominante}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          {/* Cómo se calcula: sin esto, el número se lee mal. */}
          <section className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                El <strong>índice</strong> son los días perdidos sobre los días-persona que la gente
                estuvo vinculada en el periodo, no sobre las filas de asistencia. Cuenta como
                ausentismo la <strong>incapacidad</strong> (general o por accidente) y la{" "}
                <strong>licencia no remunerada</strong>; las vacaciones y los descansos no, porque
                son derechos programados. Una persona con dos turnos el mismo día cuenta como un
                solo día perdido, y los días consecutivos de la misma causa son{" "}
                <strong>un evento</strong>. El <strong>costo</strong> toma el salario registrado
                dividido en 30 —el mismo valor-día de la nómina— y deja fuera a quien no tiene
                salario en Head Count en vez de estimárselo.
              </span>
            </p>
          </section>
        </>
      )}
    </div>
  )
}

export default IndicadoresAusentismo
