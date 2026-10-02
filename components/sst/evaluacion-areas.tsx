"use client"

// Evaluación de desempeño por ÁREA — despliegue del BSC a nivel LIP (global, no por
// proyecto). Cada indicador pesa dentro de su área (Σ=100); la nota del área = Σ(cumpl ×
// peso) y evalúa a la cabeza de área. La BSC gerencial sigue siendo global de LIP.
import { useEffect, useMemo, useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { SigHeader, SigKpi, SigSection } from "@/components/sst/sig-ui"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { getEvaluacionAreas, guardarPesosArea, getEvaluacionCoordinadores, type AreaEval, type CoordinadorEval } from "@/lib/sig-actions"
import { Loader2, Target, Pencil, Save, X, TrendingUp, Users } from "lucide-react"

const colorNota = (n: number) => (n >= 90 ? "#16a34a" : n >= 75 ? "#0d9488" : n >= 60 ? "#f59e0b" : "#dc2626")
const fmtNum = (v: number | null, dec = 1) =>
  v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(dec)

export function EvaluacionAreas() {
  const { toast } = useToast()
  const [areas, setAreas] = useState<AreaEval[]>([])
  const [coordinadores, setCoordinadores] = useState<CoordinadorEval[]>([])
  const [global, setGlobal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editArea, setEditArea] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const [r, rc] = await Promise.all([getEvaluacionAreas(), getEvaluacionCoordinadores()])
    if (r.success) {
      setAreas(r.areas)
      setGlobal(r.global)
    } else {
      toast({ title: "Error", description: r.error, variant: "destructive" })
    }
    if (rc.success) setCoordinadores(rc.coordinadores)
    setLoading(false)
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const iniciarEdicion = (a: AreaEval) => {
    setEditArea(a.area)
    setDraft(Object.fromEntries(a.indicadores.map((i) => [i.codigo, i.peso])))
  }
  const cancelar = () => {
    setEditArea(null)
    setDraft({})
  }
  const sumaDraft = useMemo(() => Object.values(draft).reduce((s, v) => s + (Number(v) || 0), 0), [draft])

  const guardar = async (area: string) => {
    if (Math.abs(sumaDraft - 100) > 0.5) {
      toast({ title: "Los pesos deben sumar 100%", description: `Suma actual: ${Math.round(sumaDraft * 10) / 10}%`, variant: "destructive" })
      return
    }
    setSaving(true)
    const pesos = Object.entries(draft).map(([codigo, peso]) => ({ codigo, peso: Number(peso) || 0 }))
    const r = await guardarPesosArea(area, pesos)
    setSaving(false)
    if (r.success) {
      toast({ title: "Pesos actualizados", description: `Área ${area}` })
      cancelar()
      load()
    } else {
      toast({ title: "Error", description: r.error, variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4">
      <SigHeader
        title="Evaluación de desempeño por área"
        subtitle="Despliegue del BSC a nivel LIP: cada indicador pesa dentro de su área (Σ=100). La nota pondera el cumplimiento y evalúa a la cabeza de área. Global de LIP, no por proyecto."
        Icon={Target}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: SST_TOKENS.navy }} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SigKpi label="Desempeño global LIP" value={fmtNum(global)} unit="%" Icon={TrendingUp} accent={colorNota(global)} valueColor={colorNota(global)} sub="Promedio de las áreas" />
            <SigKpi label="Áreas evaluadas" value={String(areas.filter((a) => a.pesoTotal > 0).length)} Icon={Target} accent={SST_TOKENS.navy} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {areas.map((a) => {
              const enEdicion = editArea === a.area
              const medible = a.pesoTotal > 0
              return (
                <Card key={a.area} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold" style={{ color: SST_TOKENS.navy }}>{a.area}</div>
                      <div className="text-xs text-muted-foreground">{a.responsable || "Responsable sin asignar"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold leading-none" style={{ color: colorNota(a.nota) }}>
                        {medible ? fmtNum(a.nota) + "%" : "—"}
                      </div>
                      <div className="text-[10px] text-muted-foreground">nota del área</div>
                    </div>
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left lg-eyebrow">
                          <th className="px-1 py-1">Indicador</th>
                          <th className="px-1 py-1 text-right">Valor</th>
                          <th className="px-1 py-1 text-right">Meta</th>
                          <th className="px-1 py-1 text-right">Cumpl.</th>
                          <th className="px-1 py-1 text-right">Peso %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.indicadores.map((i) => (
                          <tr key={i.codigo} className="border-b last:border-0 align-middle">
                            <td className="px-1 py-1">
                              <div className="font-medium" style={{ color: SST_TOKENS.ink }}>{i.nombre}</div>
                              {i.perspectiva ? <div className="text-[10px] capitalize text-muted-foreground">{i.perspectiva}</div> : null}
                            </td>
                            <td className="px-1 py-1 text-right tabular-nums">{fmtNum(i.valor)}</td>
                            <td className="px-1 py-1 text-right tabular-nums text-muted-foreground">{i.meta == null ? "—" : fmtNum(i.meta)}</td>
                            <td className="px-1 py-1 text-right tabular-nums">
                              {i.cumplimiento == null ? (
                                <span className="text-[10px] text-muted-foreground">info</span>
                              ) : (
                                <span className="font-semibold" style={{ color: colorNota(i.cumplimiento) }}>{fmtNum(i.cumplimiento, 0)}%</span>
                              )}
                            </td>
                            <td className="px-1 py-1 text-right">
                              {enEdicion ? (
                                <Input
                                  type="number"
                                  className="h-6 w-16 text-right text-xs"
                                  value={draft[i.codigo] ?? 0}
                                  onChange={(e) => setDraft((d) => ({ ...d, [i.codigo]: Number(e.target.value) }))}
                                />
                              ) : (
                                <span className="tabular-nums">{i.peso > 0 ? fmtNum(i.peso) : <span className="text-muted-foreground">0</span>}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    {enEdicion ? (
                      <>
                        <Badge variant={Math.abs(sumaDraft - 100) <= 0.5 ? "default" : "destructive"}>
                          Σ pesos: {Math.round(sumaDraft * 10) / 10}% {Math.abs(sumaDraft - 100) <= 0.5 ? "✓" : "(debe ser 100)"}
                        </Badge>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={cancelar} disabled={saving}><X className="mr-1 h-3 w-3" />Cancelar</Button>
                          <Button size="sm" onClick={() => guardar(a.area)} disabled={saving} style={{ background: SST_TOKENS.navy, color: "white" }}>
                            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}Guardar
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] text-muted-foreground">Σ pesos del área: {fmtNum(a.pesoTotal)}%</span>
                        <Button size="sm" variant="outline" onClick={() => iniciarEdicion(a)}><Pencil className="mr-1 h-3 w-3" />Ajustar pesos</Button>
                      </>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {/* Despliegue en cascada: la Gerencia responde por el global; cada coordinador
              por su proyecto (mismos indicadores de gestión, calculados por ID de empresa). */}
          {coordinadores.length > 0 && (
            <Card className="p-4">
              <SigSection
                title="Desempeño de coordinadores por proyecto (Operaciones)"
                right={<span className="text-[10px] text-muted-foreground">Gestión por ID de empresa · la Gerencia responde por el global</span>}
              />
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left lg-eyebrow">
                      <th className="px-2 py-1">Proyecto</th>
                      <th className="px-2 py-1">Coordinador</th>
                      <th className="px-2 py-1 text-right">Nota</th>
                      <th className="px-2 py-1">Indicadores de gestión (cumplimiento)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coordinadores.map((c) => (
                      <tr key={c.idempresa} className="border-b last:border-0 align-top">
                        <td className="px-2 py-2 font-medium" style={{ color: SST_TOKENS.navy }}>{c.proyecto}</td>
                        <td className="px-2 py-2">
                          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3 text-muted-foreground" />{c.coordinador}</span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <span className="text-lg font-bold" style={{ color: colorNota(c.nota) }}>{c.pesoTotal > 0 ? fmtNum(c.nota) + "%" : "—"}</span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            {c.indicadores.filter((i) => i.peso > 0).map((i) => (
                              <span
                                key={i.codigo}
                                className="rounded px-1.5 py-0.5 text-[10px] text-white"
                                style={{ background: i.cumplimiento == null ? "#94a3b8" : colorNota(i.cumplimiento) }}
                                title={`${i.nombre}: ${i.valor ?? "—"} / meta ${i.meta} · peso ${i.peso}%`}
                              >
                                {i.nombre.length > 18 ? i.nombre.slice(0, 18) + "…" : i.nombre}: {i.cumplimiento == null ? "—" : fmtNum(i.cumplimiento, 0) + "%"}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
