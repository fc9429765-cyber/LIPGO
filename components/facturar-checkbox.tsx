"use client"

// Check "Facturar" reutilizable para Picking (cargues) y Packing (distribución).
// Encendido por defecto. Al DESMARCAR (excluir del cobro) pide CONFIRMACIÓN con un
// motivo opcional y deja RASTRO en `facturar_registro` (vía setFacturarOrden) para
// análisis posterior. Reactivar (marcar) no pide confirmación pero también se registra.

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { AlertTriangle } from "lucide-react"
import { setFacturarOrden } from "@/lib/packing-actions"
import { useToast } from "@/hooks/use-toast"

interface FacturarCheckboxProps {
  orden: { id: number; ordendecargue: string; placa?: string | null; tipooperacion?: string | null }
  facturar?: boolean | null
  idempresa?: number | null
  usuario?: string | null
  modulo: "Picking" | "Packing"
  /** Si la orden ya está finalizada, el check se bloquea (no se puede modificar). */
  disabled?: boolean
  onChanged?: (v: boolean) => void
}

export function FacturarCheckbox({ orden, facturar, idempresa, usuario, modulo, disabled, onChanged }: FacturarCheckboxProps) {
  const { toast } = useToast()
  const checked = facturar !== false
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [saving, setSaving] = useState(false)

  const guardar = async (value: boolean, motivoTxt?: string | null) => {
    setSaving(true)
    const res = await setFacturarOrden(orden.id, value, {
      usuario,
      motivo: motivoTxt ?? null,
      modulo,
      ordendecargue: orden.ordendecargue,
      idempresa: idempresa ?? null,
      tipooperacion: orden.tipooperacion ?? null,
      placa: orden.placa ?? null,
    })
    setSaving(false)
    if (res.success) {
      onChanged?.(value)
      toast({ title: value ? "Se facturará" : "No se facturará", description: res.message })
      return true
    }
    toast({ title: "Error", description: res.message, variant: "destructive" })
    return false
  }

  const onToggle = (next: boolean) => {
    if (!next) {
      // Desactivar (excluir del cobro): confirmar + motivo. El check NO cambia
      // visualmente hasta confirmar (queda controlado por `facturar`).
      setMotivo("")
      setConfirmOpen(true)
    } else {
      void guardar(true)
    }
  }

  const confirmarDesactivar = async () => {
    const ok = await guardar(false, motivo.trim() || null)
    if (ok) setConfirmOpen(false)
  }

  return (
    <>
      <input
        type="checkbox"
        className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onToggle(e.target.checked)}
        title={
          disabled
            ? "Orden finalizada: el check ya no se puede modificar"
            : "Facturar esta orden (desmarca si LIP no prestó el servicio)"
        }
      />
      <Dialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> ¿Excluir esta orden de la facturación?
            </DialogTitle>
            <DialogDescription>
              La orden <strong>{orden.ordendecargue}</strong> NO se cobrará (no aparecerá en Solicitar Facturas).
              Esta acción queda <strong>registrada</strong> para análisis posterior.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-sm">Motivo (opcional, ayuda al análisis)</Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: el vehículo trae su propio personal / el conductor va solo…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarDesactivar} disabled={saving}>
              {saving ? "Guardando…" : "Sí, no facturar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
