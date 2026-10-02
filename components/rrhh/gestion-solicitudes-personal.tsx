"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { getVacantes, gestionarAprobacionVacante } from "@/lib/rrhh-actions"
import { CheckCircle2, XCircle, Clock, ShieldCheck, Briefcase } from "lucide-react"

interface Vacante {
  id: string
  proyecto?: string
  cargo: string
  headcount: number
  turno: string
  ciudad: string
  rango_salarial_min: number
  rango_salarial_max: number
  requisitos: string
  estado: string
  aprobacion_rrhh: "pendiente" | "aprobado" | "rechazado" | null
  aprobacion_operaciones: "pendiente" | "aprobado" | "rechazado" | null
  motivo_rechazo: string | null
  created_at: string
}

// Etiqueta visual del estado de una aprobacion individual.
function AprobacionBadge({ valor }: { valor: string | null }) {
  if (valor === "aprobado") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Aprobado
      </Badge>
    )
  }
  if (valor === "rechazado") {
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 gap-1">
        <XCircle className="h-3 w-3" /> Rechazado
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" /> Pendiente
    </Badge>
  )
}

export default function GestionSolicitudesPersonal() {
  const [vacantes, setVacantes] = useState<Vacante[]>([])
  const [loading, setLoading] = useState(true)
  const [rechazo, setRechazo] = useState<{
    id: string
    rol: "RRHH" | "Operaciones"
  } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const { toast } = useToast()

  const loadData = async () => {
    setLoading(true)
    const result = await getVacantes()
    if (result.success) {
      setVacantes(result.data as Vacante[])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleAprobar = async (id: string, rol: "RRHH" | "Operaciones") => {
    setProcesando(true)
    const result = await gestionarAprobacionVacante(id, rol, "aprobar")
    setProcesando(false)
    if (result.success) {
      toast({
        title: "Aprobación registrada",
        description:
          result.nuevoEstado === "aprobado"
            ? "Ambas aprobaciones completadas: la solicitud quedó aprobada."
            : `Aprobación de ${rol} registrada. Falta la otra aprobación.`,
      })
      loadData()
    } else {
      toast({ title: "Error", description: result.message || "No se pudo aprobar" })
    }
  }

  const handleRechazar = async () => {
    if (!rechazo) return
    if (!motivo.trim()) {
      toast({ title: "Error", description: "El motivo de rechazo es obligatorio" })
      return
    }
    setProcesando(true)
    const result = await gestionarAprobacionVacante(rechazo.id, rechazo.rol, "rechazar", motivo)
    setProcesando(false)
    if (result.success) {
      toast({ title: "Solicitud rechazada" })
      setRechazo(null)
      setMotivo("")
      loadData()
    } else {
      toast({ title: "Error", description: result.message || "No se pudo rechazar" })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Aprobación de Solicitudes de Personal</h1>
        <p className="text-muted-foreground">
          Revisa las solicitudes de personal. Cada una requiere la aprobación de RRHH y del Gerente de
          Operaciones.
        </p>
      </div>

      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cargo</TableHead>
              <TableHead>HC</TableHead>
              <TableHead>Turno</TableHead>
              <TableHead>Ciudad</TableHead>
              <TableHead>Rango Salarial</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> RRHH
                </span>
              </TableHead>
              <TableHead>
                <span className="flex items-center gap-1">
                  <Briefcase className="h-3.5 w-3.5" /> Operaciones
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-6">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : vacantes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-6 text-muted-foreground">
                  No hay solicitudes de personal
                </TableCell>
              </TableRow>
            ) : (
              vacantes.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.cargo}</TableCell>
                  <TableCell>{v.headcount}</TableCell>
                  <TableCell className="capitalize">{v.turno}</TableCell>
                  <TableCell>{v.ciudad}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    ${(v.rango_salarial_min || 0).toLocaleString()} - $
                    {(v.rango_salarial_max || 0).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        v.estado === "aprobado"
                          ? "bg-green-100 text-green-800"
                          : v.estado === "rechazado"
                            ? "bg-red-100 text-red-800"
                            : "bg-yellow-100 text-yellow-800"
                      }`}
                    >
                      {v.estado === "aprobado"
                        ? "Aprobado"
                        : v.estado === "rechazado"
                          ? "Rechazado"
                          : "En revisión"}
                    </span>
                    {v.estado === "rechazado" && v.motivo_rechazo && (
                      <p className="mt-1 text-[11px] text-muted-foreground max-w-[180px]">
                        {v.motivo_rechazo}
                      </p>
                    )}
                  </TableCell>
                  {(["RRHH", "Operaciones"] as const).map((rol) => {
                    const valor = rol === "RRHH" ? v.aprobacion_rrhh : v.aprobacion_operaciones
                    return (
                      <TableCell key={rol}>
                        <div className="flex flex-col gap-1.5">
                          <AprobacionBadge valor={valor ?? "pendiente"} />
                          {valor !== "aprobado" && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                disabled={procesando}
                                onClick={() => handleAprobar(v.id, rol)}
                              >
                                Aprobar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-destructive"
                                disabled={procesando}
                                onClick={() => {
                                  setRechazo({ id: v.id, rol })
                                  setMotivo("")
                                }}
                              >
                                Rechazar
                              </Button>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Dialogo de rechazo */}
      <Dialog open={!!rechazo} onOpenChange={(o) => !o && setRechazo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar solicitud ({rechazo?.rol})</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="motivo-rechazo">Motivo del rechazo *</Label>
            <Textarea
              id="motivo-rechazo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Explica por qué se rechaza la solicitud..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRechazo(null)} disabled={procesando}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleRechazar} disabled={procesando}>
              {procesando ? "Rechazando..." : "Confirmar rechazo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
