"use client"

// Diálogos de las acciones con clave de Gestionar pedidos. Son los mismos de la
// pantalla anterior (aprobar cartera, aprobar, anular, cerrar pendiente, cierre
// con factura, eliminar) sobre las MISMAS server actions de lib/orders-actions.tsx.
// Solo cambió dónde viven y cómo se abren.

import { useEffect, useState } from "react"
import { Loader2, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { AyudaClaveAutorizacion } from "@/components/mi-clave-autorizacion"
import { toast } from "@/hooks/use-toast"
import { approveOrder, approveCartera, annulOrder, closePendingOrder, closeOrderWithInvoice, getOrderDetails, deleteOrder } from "@/lib/orders-actions"
import type { PedidoCola } from "@/lib/pedidos-cola-actions"
import { fechaCortaAnio } from "./formato"

export type TipoAccion = "aprobar" | "cartera" | "anular" | "cerrar_pendiente" | "cierre_factura" | "eliminar"
export interface Accion {
  tipo: TipoAccion
  pedido: PedidoCola
}

export function AccionesPedidoDialogos({ accion, onClose, onDone }: { accion: Accion | null; onClose: () => void; onDone: () => void }) {
  const [clave, setClave] = useState("")
  const [verClave, setVerClave] = useState(false)
  const [obs, setObs] = useState("")
  const [error, setError] = useState("")
  const [trabajando, setTrabajando] = useState(false)
  const [factura, setFactura] = useState("")
  const [lineasFactura, setLineasFactura] = useState<any[]>([])

  useEffect(() => {
    setClave("")
    setVerClave(false)
    setObs("")
    setError("")
    setTrabajando(false)
    setFactura("")
    setLineasFactura([])
    if (accion?.tipo === "cierre_factura") {
      getOrderDetails(accion.pedido.idpedido).then((r) => {
        if (r.success && r.data) setLineasFactura(r.data.map((item: any) => ({ ...item, unidadesRecibidas: item.unidades || 0 })))
        else {
          toast({ title: "Error", description: "No se pudieron cargar los detalles del pedido para la facturación.", variant: "destructive" })
          onClose()
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accion?.tipo, accion?.pedido.idpedido])

  if (!accion) return null
  const p = accion.pedido
  const cerrar = () => {
    if (!trabajando) onClose()
  }
  const listo = (mensaje: string) => {
    toast({ title: "Listo", description: mensaje })
    onDone()
    onClose()
  }

  const confirmarAprobar = async () => {
    if (!clave) return
    setTrabajando(true)
    setError("")
    const r = await approveOrder(p.idpedido, clave)
    setTrabajando(false)
    if (r.success) listo(r.message || "Pedido aprobado correctamente.")
    else setError(r.message || "Clave incorrecta")
  }

  const confirmarCartera = async () => {
    if (!clave.trim()) return
    setTrabajando(true)
    setError("")
    try {
      // La clave se valida dentro de approveCartera (atómica con la escritura).
      const r = await approveCartera(p.idpedido, clave)
      if (r.success) listo("Aprobación de cartera registrada.")
      else setError(r.message || "No se pudo registrar la aprobación de cartera")
    } finally {
      setTrabajando(false)
    }
  }

  const confirmarAnular = async () => {
    setTrabajando(true)
    const r = await annulOrder(p.idpedido, clave, obs)
    setTrabajando(false)
    if (r.success) listo(r.message || "Pedido anulado.")
    else setError(r.message || "No se pudo anular el pedido")
  }

  const confirmarCerrarPendiente = async () => {
    setTrabajando(true)
    const r = await closePendingOrder(p.idpedido, clave, obs)
    setTrabajando(false)
    if (r.success) listo(r.message || "Pedido cerrado.")
    else setError(r.message || "No se pudo cerrar el pedido")
  }

  const confirmarFactura = async () => {
    if (!factura) {
      setError("Debe ingresar el número de factura")
      return
    }
    setTrabajando(true)
    const r = await closeOrderWithInvoice(
      p.idpedido,
      factura,
      lineasFactura.map((l) => ({ transid: l.transid, unidadesRecibidas: l.unidadesRecibidas })),
    )
    setTrabajando(false)
    if (r.success) listo(r.message || "Cierre con factura registrado.")
    else setError(r.message || "No se pudo registrar el cierre")
  }

  const confirmarEliminar = async () => {
    setTrabajando(true)
    const r = await deleteOrder(p.idpedido)
    setTrabajando(false)
    if (r.success) listo("Pedido eliminado.")
    else toast({ title: "No se pudo eliminar", description: r.message, variant: "destructive" })
  }

  // Función de render (no componente): si fuera un componente definido aquí dentro,
  // React lo remontaría en cada tecla y el campo perdería el foco.
  const campoClave = (id: string, etiqueta: string) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{etiqueta}</Label>
        <AyudaClaveAutorizacion />
      </div>
      <div className="relative">
        <Input
          id={id}
          type={verClave ? "text" : "password"}
          value={clave}
          onChange={(e) => {
            setClave(e.target.value)
            setError("")
          }}
          placeholder="Tu clave personal"
          disabled={trabajando}
          className={error ? "border-red-500 pr-10" : "pr-10"}
          autoComplete="off"
        />
        <Button type="button" variant="ghost" size="sm" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setVerClave((v) => !v)} disabled={trabajando} aria-label={verClave ? "Ocultar clave" : "Ver clave"}>
          {verClave ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
        </Button>
      </div>
      {error && <p className="text-xs text-critico-fg">{error}</p>}
    </div>
  )

  const titulo = `#${p.idpedido}${p.pedido ? ` · N° ${p.pedido}` : ""} · ${p.cliente}`

  if (accion.tipo === "eliminar") {
    return (
      <AlertDialog open onOpenChange={(o) => !o && cerrar()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el pedido {titulo}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción borra el pedido y sus líneas y no se puede deshacer. Solo aplica a pedidos nuevos, sin revisión de cartera ni aprobación. Si el pedido ya fue gestionado y no se va a entregar, usa Anular o Depurar pendientes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trabajando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarEliminar} disabled={trabajando} className="bg-red-600 hover:bg-red-700">
              {trabajando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  if (accion.tipo === "cierre_factura") {
    return (
      <Dialog open onOpenChange={(o) => !o && cerrar()}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cierre con factura · {titulo}</DialogTitle>
            <DialogDescription>Registra el número de factura y las unidades recibidas por línea. La fecha de entrega queda como hoy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><span className="text-muted-foreground">Cliente:</span> {p.cliente}</p>
              <p><span className="text-muted-foreground">Fecha del pedido:</span> {fechaCortaAnio(p.fecha)}</p>
              <p><span className="text-muted-foreground">Destino:</span> {p.destino || "—"}</p>
              <p><span className="text-muted-foreground">Vendedor:</span> {p.vendedor || "—"}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="factura">Factura *</Label>
              <Input id="factura" value={factura} onChange={(e) => { setFactura(e.target.value); setError("") }} placeholder="Número de factura" />
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left">Producto</th><th className="px-3 py-2 text-right">Unidades</th><th className="px-3 py-2 text-right">Recibidas</th></tr>
                </thead>
                <tbody>
                  {lineasFactura.map((l, i) => (
                    <tr key={l.transid} className="border-t border-border">
                      <td className="px-3 py-2">{l.producto}</td>
                      <td className="lg-num px-3 py-2 text-right">{l.unidades}</td>
                      <td className="px-3 py-2 text-right">
                        <Input
                          type="number"
                          min="0"
                          max={l.unidades}
                          value={l.unidadesRecibidas}
                          onChange={(e) => {
                            const copia = [...lineasFactura]
                            copia[i] = { ...copia[i], unidadesRecibidas: Number(e.target.value) }
                            setLineasFactura(copia)
                          }}
                          className="ml-auto w-24 text-right"
                        />
                      </td>
                    </tr>
                  ))}
                  {lineasFactura.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground">Cargando líneas…</td></tr>}
                </tbody>
              </table>
            </div>
            {error && <p className="text-xs text-critico-fg">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cerrar} disabled={trabajando}>Cancelar</Button>
            <Button onClick={confirmarFactura} disabled={trabajando || !factura}>
              {trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const textos: Record<Exclude<TipoAccion, "eliminar" | "cierre_factura">, { titulo: string; descripcion: string; etiquetaClave: string; boton: string; conObs: boolean; confirmar: () => void; destructivo?: boolean }> = {
    aprobar: {
      titulo: "Aprobar pedido",
      descripcion: "Aprobación de gerencia (canal manual). Una vez aprobado, el pedido no se puede editar ni eliminar.",
      etiquetaClave: "Clave de autorización (gerencia)",
      boton: "Aprobar",
      conObs: false,
      confirmar: confirmarAprobar,
    },
    cartera: {
      titulo: "Aprobar cartera",
      descripcion: "Registra la revisión de cartera con el nombre de quien autoriza.",
      etiquetaClave: "Clave de autorización (cartera)",
      boton: "Aprobar cartera",
      conObs: false,
      confirmar: confirmarCartera,
    },
    anular: {
      titulo: "Anular pedido",
      descripcion: "El pedido queda como anulado. Solo aplica a pedidos aprobados sin orden de cargue.",
      etiquetaClave: "Clave de autorización",
      boton: "Anular pedido",
      conObs: true,
      confirmar: confirmarAnular,
      destructivo: true,
    },
    cerrar_pendiente: {
      titulo: "Cerrar pedido pendiente",
      descripcion: 'El pedido parcial queda como "entrega parcial": lo cargado se conserva y lo pendiente no se va a entregar.',
      etiquetaClave: "Clave de autorización",
      boton: "Cerrar pendiente",
      conObs: true,
      confirmar: confirmarCerrarPendiente,
    },
  }
  const t = textos[accion.tipo]

  return (
    <Dialog open onOpenChange={(o) => !o && cerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.titulo}</DialogTitle>
          <DialogDescription>
            <span className="lg-num font-medium text-foreground">{titulo}</span>
            <br />
            {t.descripcion}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {campoClave(`clave-${accion.tipo}`, t.etiquetaClave)}
          {t.conObs && (
            <div className="space-y-2">
              <Label htmlFor={`obs-${accion.tipo}`}>Observaciones</Label>
              <Textarea id={`obs-${accion.tipo}`} value={obs} onChange={(e) => setObs(e.target.value)} rows={3} placeholder="Motivo o nota" disabled={trabajando} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={cerrar} disabled={trabajando}>Cancelar</Button>
          <Button onClick={t.confirmar} disabled={!clave || trabajando} variant={t.destructivo ? "destructive" : "default"}>
            {trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t.boton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
