"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingDown, TrendingUp } from "lucide-react"
import { cn } from "@/lib/utils"

const fmtCOP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
})

const fmtPct = new Intl.NumberFormat("es-CO", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

interface Props {
  totalIngresos: number
  utilidadBruta: number
  totalGastos: number
  isLoading?: boolean
}

/**
 * Seccion final del Estado de Resultados.
 *
 * Calcula la utilidad neta = utilidad bruta - total de gastos, y el
 * margen neto sobre ingresos. Es un calculo derivado puro: no toca BD.
 *
 * Diseno: bloque destacado, mas grande que las otras secciones, porque
 * es el indicador clave del periodo. Color condicional para distinguir
 * utilidad (primary) de perdida (destructive) y dejar evidente el
 * resultado de un vistazo.
 */
export default function SeccionUtilidadNeta({
  totalIngresos,
  utilidadBruta,
  totalGastos,
  isLoading,
}: Props) {
  const utilidadNeta = utilidadBruta - totalGastos
  const margen = totalIngresos > 0 ? utilidadNeta / totalIngresos : 0
  const esUtilidad = utilidadNeta >= 0

  return (
    <Card
      className={cn(
        "border-2",
        esUtilidad ? "border-primary/40" : "border-destructive/40",
      )}
    >
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Utilidad Neta</span>
          <span className="text-xs font-normal text-muted-foreground">
            Utilidad Bruta − Total Gastos
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
          </div>
        ) : (
          <div
            className={cn(
              "rounded-lg p-5",
              esUtilidad ? "bg-primary/10" : "bg-destructive/10",
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              {/* Valor principal */}
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-xs font-medium uppercase tracking-wide",
                    esUtilidad ? "text-primary" : "text-destructive",
                  )}
                >
                  {esUtilidad ? "Utilidad" : "Perdida"} del periodo
                </p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-bold tabular-nums sm:text-4xl",
                    esUtilidad ? "text-primary" : "text-destructive",
                  )}
                >
                  {fmtCOP.format(utilidadNeta)}
                </p>
              </div>

              {/* Margen sobre ingresos */}
              <div className="flex items-center gap-2">
                {esUtilidad ? (
                  <TrendingUp
                    className="h-5 w-5 text-primary shrink-0"
                    aria-hidden="true"
                  />
                ) : (
                  <TrendingDown
                    className="h-5 w-5 text-destructive shrink-0"
                    aria-hidden="true"
                  />
                )}
                <div>
                  <p className="lg-eyebrow">
                    Margen neto
                  </p>
                  <p
                    className={cn(
                      "text-xl font-semibold tabular-nums",
                      esUtilidad ? "text-primary" : "text-destructive",
                    )}
                  >
                    {totalIngresos > 0 ? fmtPct.format(margen) : "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* Detalle del calculo en una sola linea para auditoria rapida */}
            <div className="mt-4 grid gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2">
                <span>Utilidad Bruta</span>
                <span className="font-medium tabular-nums text-foreground">
                  {fmtCOP.format(utilidadBruta)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>− Total Gastos</span>
                <span className="font-medium tabular-nums text-foreground">
                  {fmtCOP.format(totalGastos)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>= Utilidad Neta</span>
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    esUtilidad ? "text-primary" : "text-destructive",
                  )}
                >
                  {fmtCOP.format(utilidadNeta)}
                </span>
              </div>
            </div>
          </div>
        )}

        {totalIngresos === 0 && !isLoading && (
          <p className="mt-3 text-xs text-muted-foreground">
            No hay ingresos en el periodo, el margen no se puede calcular.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
