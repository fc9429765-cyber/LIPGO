"use client"

/**
 * Ficha del trabajador -- se abre con un clic en el nombre de cualquier fila
 * de "Personal activo" en Programar el día. Dos pestañas:
 *
 *  - Resumen: toneladas acumuladas, % de meta, horas extra de la semana,
 *    días trabajados (mismo cálculo que Control de Toneladas).
 *  - Quincena: grilla día por día con el puesto en que estuvo cada día
 *    (misma información que Vista de quincena → Detalle por persona),
 *    para validar la rotación sin salir de esta pantalla.
 */

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2 } from "lucide-react"
import { getFichaTrabajador, type FichaTrabajador } from "@/lib/ficha-trabajador-actions"

const PUESTO_COLORES = [
  "bg-sky-100 text-sky-700 border-sky-200",
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-violet-100 text-violet-700 border-violet-200",
]

function colorDePuesto(puesto: string, orden: string[]): string {
  const i = orden.indexOf(puesto)
  return PUESTO_COLORES[(i >= 0 ? i : 0) % PUESTO_COLORES.length]
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/)
  return ((partes[0]?.[0] || "") + (partes[1]?.[0] || "")).toUpperCase()
}

export function FichaTrabajadorDialog({
  open,
  onOpenChange,
  empresaId,
  identificacion,
  fecha,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  empresaId: number | null
  identificacion: string | null
  fecha: string
}) {
  const [loading, setLoading] = useState(false)
  const [ficha, setFicha] = useState<FichaTrabajador | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !empresaId || !identificacion) return
    let mounted = true
    setLoading(true)
    setError(null)
    setFicha(null)
    getFichaTrabajador(empresaId, identificacion, fecha).then((res) => {
      if (!mounted) return
      setLoading(false)
      if (res.success && res.data) setFicha(res.data)
      else setError(res.message || "No se pudo cargar la ficha.")
    })
    return () => {
      mounted = false
    }
  }, [open, empresaId, identificacion, fecha])

  const puestosOrden = Array.from(new Set((ficha?.quincena.dias || []).map((d) => d.puesto).filter((p): p is string => !!p)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
              {ficha ? iniciales(ficha.nombre) : "…"}
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate">{ficha?.nombre || "Ficha del trabajador"}</DialogTitle>
              <DialogDescription className="truncate">
                {ficha?.cargo || "—"} · <span className="tabular-nums">{ficha?.identificacion || identificacion}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Cargando…
          </div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-destructive">{error}</div>
        ) : ficha ? (
          <Tabs defaultValue="resumen" className="mt-2">
            <TabsList>
              <TabsTrigger value="resumen">Resumen</TabsTrigger>
              <TabsTrigger value="quincena">Quincena{ficha.quincena.etiqueta ? ` · ${ficha.quincena.etiqueta}` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="resumen" className="space-y-4 pt-3">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-lg font-bold tabular-nums">{ficha.resumen.tonAcumulada.toFixed(1)}t</div>
                  <div className="lg-eyebrow">Ton. acumuladas</div>
                </div>
                <div className={`rounded-lg border p-3 ${ficha.resumen.pctCumplimiento < 70 ? "border-amber-300 bg-amber-50" : "bg-muted/30"}`}>
                  <div className={`text-lg font-bold tabular-nums ${ficha.resumen.pctCumplimiento < 70 ? "text-amber-700" : ""}`}>
                    {ficha.resumen.pctCumplimiento}%
                  </div>
                  <div className="lg-eyebrow">Meta cumplida</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-lg font-bold tabular-nums">{ficha.resumen.horasExtraSemana}h</div>
                  <div className="lg-eyebrow">Horas extra sem.</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-lg font-bold tabular-nums">{ficha.resumen.diasTrabajados}</div>
                  <div className="lg-eyebrow">Días trabajados</div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Toneladas vs. meta del mes</span>
                  <span className="tabular-nums">{ficha.resumen.pctCumplimiento}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${ficha.resumen.pctCumplimiento < 70 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, Math.max(0, ficha.resumen.pctCumplimiento))}%` }}
                  />
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Fuente: Control de Toneladas (mismo cálculo que Revisión de Nómina) + horas extra de los últimos 7 días.
              </p>
            </TabsContent>

            <TabsContent value="quincena" className="pt-3">
              <div className="flex gap-1.5 overflow-x-auto pb-2">
                {ficha.quincena.dias.map((d) => (
                  <div key={d.fecha} className="flex w-16 shrink-0 flex-col items-center rounded-lg border p-2 text-center">
                    <span className="text-[9px] font-semibold uppercase text-muted-foreground">{d.diaSemana}</span>
                    <span className="text-sm font-bold tabular-nums">{d.diaMes}</span>
                    <span
                      className={`mt-1.5 flex min-h-[28px] w-full items-center justify-center rounded-md border px-1 text-[8.5px] font-semibold leading-tight ${
                        d.novedad
                          ? "border-muted bg-muted text-muted-foreground"
                          : d.puesto
                            ? colorDePuesto(d.puesto, puestosOrden)
                            : "border-dashed border-muted text-muted-foreground"
                      }`}
                      title={d.novedad || d.puesto || "Sin programar"}
                    >
                      {d.novedad ? "Novedad" : d.puesto || "—"}
                    </span>
                  </div>
                ))}
              </div>
              {puestosOrden.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2.5">
                  {puestosOrden.map((puesto) => (
                    <span key={puesto} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className={`h-2.5 w-2.5 rounded-sm border ${colorDePuesto(puesto, puestosOrden)}`} />
                      {puesto}
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Misma grilla de «Vista de quincena → Detalle por persona» — se abre aquí para validar en qué puesto ha estado sin cambiar de pestaña.
              </p>
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
