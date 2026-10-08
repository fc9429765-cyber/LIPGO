"use client"

// Diálogo compartido para asignar/corregir la novedad de un registro de
// asistencia de UN día puntual. Extraído de components/attendance-viewer.tsx
// para que "Registros" y el Dashboard Diario (Visor de Asistencia) usen
// EXACTAMENTE la misma lógica de guardado y efectos laterales -- ninguna
// copia debe divergir de la otra.

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { actualizarNovedadAsistencia } from "@/lib/novedades-periodo-actions"
import { procesarNovedadRetiro } from "@/lib/retiro-actions"
import { sincronizarBorradorAusentismo } from "@/lib/ausentismos-actions"
import { NOVEDADES_DIA } from "@/lib/asistencia-catalogos"

export interface RegistroParaEditarNovedad {
  id: number
  identificacion: string
  fecha: string
  nombre: string
  asistencia: string | null
}

interface Props {
  empresaId: number | null
  registro: RegistroParaEditarNovedad | null
  onOpenChange: (open: boolean) => void
  /** Se llama tras guardar con éxito, para que el caller refresque su lista. */
  onSaved: () => void
}

export function EditNovedadDialog({ empresaId, registro, onOpenChange, onSaved }: Props) {
  const { toast } = useToast()
  const [novedad, setNovedad] = useState<string>(registro?.asistencia || "")
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!registro) return
    setSaving(true)
    try {
      // Server action con puerta (Tabla Asistencia / Novedades / Visor › editar).
      const r = await actualizarNovedadAsistencia(registro.id, novedad || null)
      if (!r.success) {
        toast({ title: "Error", description: r.message || "No se pudo actualizar la novedad", variant: "destructive" })
        return
      }

      // Efecto automático: si la novedad es "Retiro", dar de baja al trabajador
      // (Inactivo + fecha de retiro + fuera del plano). No bloquea el guardado.
      let bajaAplicada = false
      if (String(novedad || "").toLowerCase().includes("retiro")) {
        const r = await procesarNovedadRetiro({
          identificacion: registro.identificacion,
          fecha: registro.fecha,
          asistencia: novedad,
        })
        bajaAplicada = !!r.aplicado
      }

      // Puente automático: reconcilia el borrador de ausentismo de esta persona.
      if (empresaId && registro.identificacion && registro.fecha) {
        try {
          await sincronizarBorradorAusentismo(empresaId, registro.identificacion, registro.fecha)
        } catch (e) {
          console.error("[EditNovedadDialog] sincronizarBorradorAusentismo:", e)
        }
      }

      toast({
        title: "Éxito",
        description: bajaAplicada
          ? "Retiro registrado: trabajador dado de baja (Inactivo) y retirado del plano."
          : "Novedad actualizada correctamente",
      })

      onOpenChange(false)
      onSaved()
    } catch (error) {
      console.error("[EditNovedadDialog] Error saving notice:", error)
      toast({ title: "Error", description: "Ocurrió un error al guardar", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!registro} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar Novedad</DialogTitle>
          <DialogDescription>{registro && `${registro.nombre} - ${registro.fecha}`}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Novedad</label>
            <Select value={novedad} onValueChange={setNovedad}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar novedad..." />
              </SelectTrigger>
              <SelectContent>
                {NOVEDADES_DIA.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-1">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
