"use client"

// Submódulo "Acumulados LIPgo" (Compensación): reporte de acumulados que
// LIPgo CONSTRUYE con su propia data ya reconciliada (misma columnas del
// export real de Siigo). Pedido explícito del usuario 2026-09: "los próximos
// acumulados deben salir de acá de LIPgo, en adelante no habrá otra fuente de
// información" -- este módulo GENERA el reporte, no compara contra Siigo.

import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/components/ui/use-toast"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, FileSpreadsheet, Download, RefreshCw, Info } from "lucide-react"
import { getAcumuladosLIPgo, type FilaAcumuladoLIPgo } from "@/lib/acumulados-lipgo-actions"

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 })

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export default function AcumuladosLIPgo() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()
  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  // Abre en el MES EN CURSO (antes enero→hoy: diez meses de nómina en una sola carga,
  // minutos de espera; gerencia 2026-10-03). El rango sigue siendo libre.
  const [mesDesde, setMesDesde] = useState(hoy.getMonth() + 1)
  const [mesHasta, setMesHasta] = useState(hoy.getMonth() + 1)
  const [data, setData] = useState<FilaAcumuladoLIPgo[]>([])
  const [loading, setLoading] = useState(true)

  const cargar = useCallback(async () => {
    if (!selectedEmpresaId) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    const r = await getAcumuladosLIPgo(selectedEmpresaId, anio, mesDesde, mesHasta)
    if (r.success) {
      setData(r.data)
    } else {
      setData([])
      toast({ title: "Error", description: r.message, variant: "destructive" })
    }
    setLoading(false)
  }, [selectedEmpresaId, anio, mesDesde, mesHasta, toast])

  useEffect(() => {
    cargar()
  }, [cargar])

  const totalIngresos = data.filter((f) => f.tipo === "Ingreso").reduce((s, f) => s + f.valor_total, 0)
  const totalDeducciones = data.filter((f) => f.tipo === "Deducción").reduce((s, f) => s + Math.abs(f.valor_total), 0)
  const personas = new Set(data.map((f) => f.identificacion)).size

  const exportar = async () => {
    const XLSX = await import("xlsx")
    if (data.length === 0) return
    const headers = [
      "Identificación", "Nombre empleado", "No contrato", "Periodo", "Mes", "Año",
      "Centro de costo", "Origen", "Novedad", "Tipo", "Horas/Días", "Valor total",
    ]
    const rows = data.map((f) => [
      f.identificacion, f.nombre_empleado, f.no_contrato || "", f.periodo, MESES[f.mes - 1], f.anio,
      f.centro_costo, f.origen, f.novedad, f.tipo, f.horas_dias ?? "", f.valor_total,
    ])
    try {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "Acumulados LIPgo")
      XLSX.writeFile(wb, `acumulados-lipgo-${anio}-${mesDesde}a${mesHasta}.xlsx`)
    } catch {
      toast({ title: "Error", description: "Error al exportar archivo", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-5 w-5" />
              Acumulados LIPgo
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={anio}
                onChange={(e) => setAnio(Number(e.target.value))}
              >
                {[hoy.getFullYear(), hoy.getFullYear() - 1].map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={mesDesde}
                onChange={(e) => setMesDesde(Number(e.target.value))}
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>Desde {m}</option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={mesHasta}
                onChange={(e) => setMesHasta(Number(e.target.value))}
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>Hasta {m}</option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={cargar} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Actualizar
              </Button>
              <Button size="sm" variant="outline" onClick={exportar} disabled={loading || data.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Exportar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Reporte construido con la data ya reconciliada de LIPgo (sin órdenes fantasma, incapacidad al %
              vigente, auxilio de transporte solo en días de Sueldo). Formato de columnas igual al export real de
              Siigo, para que este reemplace esa fuente hacia adelante.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Personas</p>
              <p className="text-xl font-semibold tabular-nums">{personas}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Total ingresos</p>
              <p className="text-xl font-semibold tabular-nums text-emerald-600">{money(totalIngresos)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Total deducciones</p>
              <p className="text-xl font-semibold tabular-nums text-rose-600">{money(totalDeducciones)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Identificación</TableHead>
                  <TableHead>Nombre empleado</TableHead>
                  <TableHead>Periodo</TableHead>
                  <TableHead>Centro de costo</TableHead>
                  <TableHead>Novedad</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Horas/Días</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    </TableCell>
                  </TableRow>
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      Sin datos para el periodo seleccionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.map((f, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{f.identificacion}</TableCell>
                      <TableCell className="whitespace-nowrap">{f.nombre_empleado}</TableCell>
                      <TableCell className="whitespace-nowrap">{MESES[f.mes - 1]} {f.anio} {f.periodo}</TableCell>
                      <TableCell className="whitespace-nowrap">{f.centro_costo}</TableCell>
                      <TableCell>{f.novedad}</TableCell>
                      <TableCell>{f.tipo}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.horas_dias ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(f.valor_total)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
