"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/components/auth-provider"
import { useToast } from "@/hooks/use-toast"
import { UserPlus, Loader2, X, Users, Package, RefreshCw } from "lucide-react"
import {
  getOrdenesApoyoDelDia,
  quitarApoyoDeOrden,
  type OrdenApoyo,
} from "@/lib/apoyo-cargue-actions"
// El diálogo vive aparte porque Centro de Coordinación usa EXACTAMENTE el
// mismo: dos copias podrían mostrar repartos distintos para la misma orden.
import { ApoyoCargueDialog, type OrdenParaApoyo } from "@/components/apoyo-cargue-dialog"

function hoyColombia(): string {
  const colombiaDate = new Date().toLocaleString("en-US", { timeZone: "America/Bogota" })
  return new Date(colombiaDate).toISOString().split("T")[0]
}

const money = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CO")
const ton = (n: number) => (Number(n) || 0).toLocaleString("es-CO", { maximumFractionDigits: 3 })

export function ApoyoCargue() {
  const { selectedEmpresaId } = useAuth()
  const { toast } = useToast()

  const [fecha, setFecha] = useState(hoyColombia())
  const [ordenes, setOrdenes] = useState<OrdenApoyo[]>([])
  const [loading, setLoading] = useState(false)

  const [ordenApoyo, setOrdenApoyo] = useState<OrdenParaApoyo | null>(null)

  const cargarOrdenes = useCallback(async () => {
    setLoading(true)
    const res = await getOrdenesApoyoDelDia(fecha, selectedEmpresaId)
    if (res.success) {
      setOrdenes(res.data)
    } else {
      toast({ title: "Error", description: res.message || "No se pudieron cargar las órdenes", variant: "destructive" })
    }
    setLoading(false)
  }, [fecha, selectedEmpresaId, toast])

  useEffect(() => {
    cargarOrdenes()
  }, [cargarOrdenes])

  const quitar = async (orden: OrdenApoyo, persona: string) => {
    const res = await quitarApoyoDeOrden(orden.id, persona)
    if (res.success) {
      toast({ title: "Apoyo retirado", description: `${persona} se quitó de ${orden.ordendecargue}.` })
      cargarOrdenes()
    } else {
      toast({ title: "No se pudo quitar", description: res.message || "", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Asignación de apoyo en cargue
          </CardTitle>
          <CardDescription>
            Ajusta quién entra en el reparto de toneladas de una orden de Cargue o Descargue del día. Las dos
            listas —la cuadrilla de cargue y descargue, y quienes ya terminaron su turno— salen del reporte de
            asistencia de ese día.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Fecha</label>
            <DatePickerField value={fecha} onChange={setFecha} className="w-44" />
            <Button variant="outline" size="sm" onClick={cargarOrdenes} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Cargando órdenes...
            </div>
          ) : ordenes.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No hay órdenes de Cargue/Descargue para esta fecha.
            </div>
          ) : (
            <div className="space-y-3">
              {ordenes.map((orden) => (
                <div key={orden.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span className="font-semibold">{orden.ordendecargue}</span>
                      <Badge variant="outline">{orden.tipooperacion}</Badge>
                      {orden.placa && <span className="text-sm text-muted-foreground">{orden.placa}</span>}
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span>
                        Peso base: <strong>{ton(orden.pesoBase)} t</strong>
                      </span>
                      <span>
                        Tarifa: <strong>{money(orden.tarifa)}</strong>
                      </span>
                      <Button
                        size="sm"
                        className="gap-1"
                        onClick={() =>
                          setOrdenApoyo({
                            id: orden.id,
                            ordendecargue: orden.ordendecargue,
                            auxiliares: orden.auxiliares,
                          })
                        }
                      >
                        <UserPlus className="h-4 w-4" />
                        Personal de apoyo
                      </Button>
                    </div>
                  </div>

                  {orden.pagoActualPorPersona.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin auxiliares asignados todavía.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Persona</TableHead>
                          <TableHead className="text-right">Toneladas</TableHead>
                          <TableHead className="text-right">Pago actual</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {orden.pagoActualPorPersona.map((p) => (
                          <TableRow key={p.persona}>
                            <TableCell>{p.persona}</TableCell>
                            <TableCell className="text-right">{ton(p.toneladas)} t</TableCell>
                            <TableCell className="text-right">{money(p.pago)}</TableCell>
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Sacar a esta persona del reparto de toneladas de la orden"
                                onClick={() => quitar(orden, p.persona)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* El MISMO diálogo que usa Centro de Coordinación. Aquí primero hay que
          elegir la orden de la lista del día; allá ya se sabe cuál es (la del
          muelle), pero el reparto y la previsualización son idénticos. */}
      <ApoyoCargueDialog
        orden={ordenApoyo}
        fecha={fecha}
        empresaId={selectedEmpresaId}
        onCerrar={() => setOrdenApoyo(null)}
        onAgregado={cargarOrdenes}
      />

    </div>
  )
}
