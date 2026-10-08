"use client"

// Diálogo para DUPLICAR tarifas a otro periodo: se seleccionan tarifas
// existentes, se indica un nuevo rango de vigencia y el sistema crea copias con
// esas fechas (las originales no se tocan). Evita crear tarifa por tarifa al
// actualizar precios de un periodo a otro.

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { Copy, Loader2, Search } from "lucide-react"
import { listarTarifas, duplicarTarifas, type TarifaItem } from "@/lib/tarifas-actions"
import { emitTablaChanged } from "@/lib/sync-events"
import { useClaveAccion } from "@/components/clave-accion-provider"

export function DuplicarTarifasDialog({
  open,
  onOpenChange,
  tableName,
  titulo,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  tableName: string
  titulo: string
}) {
  const { selectedEmpresaId } = useAuth()
  const { conClave } = useClaveAccion()
  const { toast } = useToast()
  const [items, setItems] = useState<TarifaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [busca, setBusca] = useState("")
  const [nuevaIni, setNuevaIni] = useState("")
  const [nuevaFin, setNuevaFin] = useState("")
  const [dup, setDup] = useState(false)

  useEffect(() => {
    if (!open) return
    setSel({})
    setBusca("")
    setNuevaIni("")
    setNuevaFin("")
    setLoading(true)
    listarTarifas(tableName, selectedEmpresaId ?? null).then((r) => {
      setItems(r.success ? r.data : [])
      setLoading(false)
      if (!r.success) toast({ title: "No se pudieron cargar las tarifas", description: r.message })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tableName, selectedEmpresaId])

  const filtrados = items.filter((i) => {
    const q = busca.trim().toLowerCase()
    if (!q) return true
    return (
      i.etiqueta.toLowerCase().includes(q) ||
      String(i.fechaIni || "").includes(q) ||
      String(i.fechaFin || "").includes(q)
    )
  })
  const seleccionados = items.filter((i) => sel[String(i.id)])

  const toggleTodos = (on: boolean) => {
    const n: Record<string, boolean> = {}
    if (on) for (const i of filtrados) n[String(i.id)] = true
    setSel(n)
  }

  const handleDuplicar = async () => {
    if (!seleccionados.length) {
      toast({ title: "Selecciona tarifas", description: "Marca las tarifas a duplicar." })
      return
    }
    if (!nuevaIni || !nuevaFin) {
      toast({ title: "Falta el nuevo rango", description: "Indica la nueva vigencia (desde/hasta)." })
      return
    }
    setDup(true)
    const r = await conClave("Tarifas", "configurar", (clave) => duplicarTarifas({
      tableName,
      ids: seleccionados.map((i) => i.id),
      nuevaFechaIni: nuevaIni,
      nuevaFechaFin: nuevaFin,
    }, clave))
    setDup(false)
    if (r.success) {
      toast({ title: `${r.creadas} tarifa(s) duplicada(s)`, description: `Nueva vigencia ${nuevaIni} → ${nuevaFin}` })
      emitTablaChanged(tableName) // refresca la tabla del CRUD
      onOpenChange(false)
    } else {
      toast({ title: "No se pudo duplicar", description: r.message })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-primary" /> Duplicar {titulo} a otro periodo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Selecciona las tarifas y define el <strong>nuevo rango de vigencia</strong>. Se crean copias
            con esas fechas; las tarifas originales <strong>no se modifican</strong>.
          </p>

          {/* Nuevo rango */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dup-ini">Nueva vigencia desde</Label>
              <DatePickerField id="dup-ini" value={nuevaIni} onChange={setNuevaIni} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dup-fin">Nueva vigencia hasta</Label>
              <DatePickerField id="dup-fin" value={nuevaFin} onChange={setNuevaFin} />
            </div>
          </div>

          {/* Buscar + seleccionar */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar tarifa..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => toggleTodos(true)}>
              Todas
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => toggleTodos(false)}>
              Ninguna
            </Button>
          </div>

          {/* Lista */}
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtrados.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No hay tarifas para mostrar.</p>
            ) : (
              filtrados.map((i) => (
                <label
                  key={String(i.id)}
                  className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-0 hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={!!sel[String(i.id)]}
                    onChange={(e) => setSel((s) => ({ ...s, [String(i.id)]: e.target.checked }))}
                  />
                  <span className="flex-1 truncate">{i.etiqueta}</span>
                  <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {i.fechaIni || "—"} → {i.fechaFin || "—"}
                  </span>
                </label>
              ))
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{seleccionados.length} seleccionada(s)</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={dup}>
                Cancelar
              </Button>
              <Button onClick={handleDuplicar} disabled={dup || !seleccionados.length || !nuevaIni || !nuevaFin}>
                {dup ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                Duplicar {seleccionados.length || ""}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
