"use client"

// Indicador de Facturación por Proyectos (módulo Gestión Financiera).
// Vista GERENCIAL: compara los 4 proyectos en gestión de facturación
// (solicitadas/total), pendientes por solicitar y valor pendiente. Mes actual
// por defecto (el backlog histórico se considera cerrado). Fuente: LIPgo.

import { useCallback, useEffect, useState } from "react"
import { Loader2, Receipt, FileWarning, ShieldCheck, Building2, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { SST_TOKENS } from "@/components/sst/sst-utils"
import { SigHeader, SigKpi, SigSection, SigFilterBar, SigField, SigDatePicker } from "@/components/sst/sig-ui"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getFacturacionPorProyecto } from "@/lib/sig-actions"

const mesActualIni = () => {
  const h = new Date()
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`
}

const fmtCOP = (v: number) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v || 0)
const colorPct = (v: number, meta: number) => (v >= meta ? SST_TOKENS.ok : v >= meta * 0.85 ? SST_TOKENS.warn : SST_TOKENS.bad)

export function FacturacionProyectosIndicador() {
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  // Por defecto: mes actual. El usuario puede ampliar el rango o ver el
  // histórico completo (la información NO se borra, solo se filtra).
  const [desde, setDesde] = useState<string>(mesActualIni())
  const [hasta, setHasta] = useState<string>("")

  const cargar = useCallback(async () => {
    setLoading(true)
    const r = await getFacturacionPorProyecto(desde || null, hasta || null)
    if (r.success) setData(r.data)
    else toast({ title: "No se pudo cargar", description: r.error })
    setLoading(false)
  }, [desde, hasta, toast])

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta])

  const t = data?.totales

  return (
    <div className="space-y-5">
      <SigHeader
        Icon={Receipt}
        title="Indicador de Facturación por Proyectos"
        subtitle={`Gestión de facturación (solicitudes) y pendiente por solicitar. Lo pendiente lo solicita el coordinador; la factura en firme la hace finanzas.`}
      />

      <SigFilterBar>
        <SigField label="Desde">
          <SigDatePicker value={desde} onChange={setDesde} />
        </SigField>
        <SigField label="Hasta">
          <SigDatePicker value={hasta} onChange={setHasta} />
        </SigField>
        <Button size="sm" variant="outline" onClick={() => { setDesde(mesActualIni()); setHasta("") }}>Este mes</Button>
        <Button size="sm" variant="ghost" onClick={() => { setDesde("2020-01-01"); setHasta("") }}>Ver histórico</Button>
        <Button size="sm" variant="outline" onClick={cargar} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </SigFilterBar>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: SST_TOKENS.navy }} />
        </div>
      ) : !data ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin datos.</p>
      ) : (
        <>
          {/* KPIs consolidados */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SigKpi label="Gestión de facturación" value={t.pct} unit="%" Icon={ShieldCheck} accent={colorPct(t.pct, 95)} valueColor={colorPct(t.pct, 95)} sub="meta 95% · solicitadas/total" />
            <SigKpi label="Valor pendiente por facturar" value={fmtCOP(t.valorPendiente)} Icon={Receipt} accent={SST_TOKENS.navy} sub={`${t.pendientes} órdenes`} />
            <SigKpi label="En riesgo (> 8 días)" value={fmtCOP(t.valorRiesgo)} Icon={FileWarning} accent={t.valorRiesgo > 0 ? SST_TOKENS.bad : SST_TOKENS.ok} valueColor={t.valorRiesgo > 0 ? SST_TOKENS.bad : undefined} />
            <SigKpi label="Operaciones facturables" value={t.facturables} Icon={Building2} accent={SST_TOKENS.navy} />
          </div>

          {/* % de gestión por proyecto — bullet chart con marcador de meta */}
          <Card className="p-4">
            <SigSection title="% de gestión de facturación por proyecto" right={<span className="text-xs font-medium text-muted-foreground">Meta 95%</span>} />
            <div className="mt-4 space-y-4">
              {data.proyectos.map((p: any) => {
                const c = colorPct(p.pct, 95)
                return (
                  <div key={p.idempresa}>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-medium" style={{ color: SST_TOKENS.ink }}>{p.proyecto}</span>
                      <span className="text-sm font-bold tabular-nums" style={{ color: c }}>{p.pct}%</span>
                    </div>
                    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-[#0d3b6e10]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, p.pct)}%`, background: `linear-gradient(90deg, ${c}aa, ${c})` }}
                      />
                      {/* marcador de meta 95% */}
                      <div className="absolute top-[-2px] h-[calc(100%+4px)] w-[2px] rounded" style={{ left: "95%", background: SST_TOKENS.navy }} title="Meta 95%" />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {p.pendientes} pendientes de {p.facturables} · {fmtCOP(p.valorPendiente)}{p.valorRiesgo > 0 ? ` · ${fmtCOP(p.valorRiesgo)} en riesgo` : ""}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* Detalle por proyecto */}
          <Card className="p-4">
            <SigSection title="Detalle por proyecto" />
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left lg-eyebrow">
                    <th className="px-2 py-2">Proyecto</th>
                    <th className="px-2 py-2 text-right">Facturables</th>
                    <th className="px-2 py-2 text-right">Pendientes</th>
                    <th className="px-2 py-2 text-right">Gestión</th>
                    <th className="px-2 py-2 text-right">Valor pendiente</th>
                    <th className="px-2 py-2 text-right">En riesgo</th>
                    <th className="px-2 py-2 text-right">Días máx</th>
                  </tr>
                </thead>
                <tbody>
                  {data.proyectos.map((p: any) => (
                    <tr key={p.idempresa} className="border-b transition-colors last:border-0 hover:bg-muted/40">
                      <td className="px-2 py-2 font-medium" style={{ color: SST_TOKENS.ink }}>{p.proyecto}</td>
                      <td className="px-2 py-2 text-right">{p.facturables}</td>
                      <td className="px-2 py-2 text-right">{p.pendientes}</td>
                      <td className="px-2 py-2 text-right font-semibold" style={{ color: colorPct(p.pct, 95) }}>{p.pct}%</td>
                      <td className="px-2 py-2 text-right font-semibold">{fmtCOP(p.valorPendiente)}</td>
                      <td className="px-2 py-2 text-right" style={{ color: p.valorRiesgo > 0 ? SST_TOKENS.bad : undefined }}>{fmtCOP(p.valorRiesgo)}</td>
                      <td className="px-2 py-2 text-right" style={{ color: p.diasMax > 8 ? SST_TOKENS.bad : p.diasMax > 4 ? SST_TOKENS.warn : undefined }}>{p.diasMax}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
