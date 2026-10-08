"use client"

// BOTÓN DE EMITIR FACTURA EN SIIGO
//
// Lo único de LIPgo que crea un documento contable. Por eso NO emite al
// pulsarlo: abre un diálogo que muestra exactamente qué se va a facturar, a
// quién y por cuánto, y pide confirmación.
//
// Una factura electrónica aceptada por la DIAN no se borra: se anula con nota
// crédito. El coste de un clic de más no es un registro mal guardado, es un
// documento fiscal que hay que deshacer con otro documento fiscal.

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, CheckCircle2, FileText, Loader2, Search } from "lucide-react"
import {
  buscarClientesSiigo,
  emitirFacturaAgrupacion,
  emitirFacturaOrden,
  emitirFacturaPrefactura,
  getConfigEmision,
  puedeFacturarAgrupacion,
  puedeFacturarOrden,
  puedeFacturarPrefactura,
} from "@/lib/siigo-emision-actions"
import { useClaveAccion } from "@/components/clave-accion-provider"

const money = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n || 0)

export default function BotonFacturarSiigo({
  ordenId,
  prefacturaId,
  ordenIds,
  periodo,
  orden,
  cliente,
  valor,
  facturaExistente,
  onEmitida,
}: {
  /** Una orden suelta (Pagos de Contado). Excluyente con `prefacturaId`. */
  ordenId?: number
  /** Una agrupación del Ciclo. Excluyente con `ordenId`. */
  prefacturaId?: number
  /** Varias órdenes en un solo documento (Facturar a SIIGO · crédito). */
  ordenIds?: number[]
  /** Texto del período, para las observaciones de la factura de agrupación. */
  periodo?: string
  orden: string
  cliente: string | null
  valor: number
  /** Si ya tiene factura, no se ofrece emitir. */
  facturaExistente?: string | null
  onEmitida?: () => void
}) {
  // Las dos formas comparten diálogo porque la decisión es la misma --qué se
  // factura, a quién, por cuánto-- y solo cambia de dónde salen las líneas.
  const esPrefactura = prefacturaId != null
  const esAgrupacion = !esPrefactura && Array.isArray(ordenIds) && ordenIds.length > 0
  const { toast } = useToast()
  const { conClave } = useClaveAccion()
  const [abierto, setAbierto] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [verificacion, setVerificacion] = useState<{ puede: boolean; motivo?: string } | null>(null)
  const [emitiendo, setEmitiendo] = useState(false)
  const [config, setConfig] = useState<Awaited<ReturnType<typeof getConfigEmision>>["data"] | null>(
    null,
  )

  // El tercero. Se deja elegir por si el puente no lo resuelve.
  const [busqueda, setBusqueda] = useState("")
  const [candidatos, setCandidatos] = useState<Array<{ identificacion: string; nombre: string }>>([])
  const [elegido, setElegido] = useState<{ identificacion: string; nombre: string } | null>(null)

  const abrir = useCallback(async () => {
    setAbierto(true)
    setVerificando(true)
    const [v, c] = await Promise.all([
      esPrefactura
        ? puedeFacturarPrefactura(prefacturaId!)
        : esAgrupacion
          ? puedeFacturarAgrupacion(ordenIds!)
          : puedeFacturarOrden(ordenId!),
      getConfigEmision(),
    ])
    setVerificacion(v)
    setConfig(c.data ?? null)
    setVerificando(false)
    // Se precarga con el nombre del cliente de la orden, por si hay que
    // elegirlo a mano.
    if (cliente) {
      setBusqueda(cliente)
      const r = await buscarClientesSiigo(cliente)
      if (r.success && r.data) setCandidatos(r.data)
    }
  }, [ordenId, prefacturaId, ordenIds, esPrefactura, esAgrupacion, cliente])

  async function buscar() {
    const r = await buscarClientesSiigo(busqueda)
    if (r.success && r.data) setCandidatos(r.data)
    else toast({ title: "No se pudo buscar", description: r.message, variant: "destructive" })
  }

  async function emitir() {
    const oficial = config?.enviarDian === true
    const ok = window.confirm(
      `Vas a emitir una factura en Siigo por ${money(valor)}.\n\n` +
        (oficial
          ? "Saldrá FIRMADA Y OFICIAL ante la DIAN. No se podrá borrar: solo anular con una nota crédito.\n\n"
          : "Quedará como borrador en Siigo; alguien debe revisarla y enviarla desde allá.\n\n") +
        "¿Continuar?",
    )
    if (!ok) return

    setEmitiendo(true)
    const extra = elegido ? { clienteIdentificacion: elegido.identificacion } : {}
    // Emitir en Siigo es una acción con clave (fac_emitir_siigo): en modo bloquear
    // se pide la clave personal; en aviso pasa y deja rastro.
    const r = await conClave("Ciclo de Facturación", "aprobar", (clave) =>
      esPrefactura
        ? emitirFacturaPrefactura(prefacturaId!, extra, clave)
        : esAgrupacion
          ? emitirFacturaAgrupacion(ordenIds!, { ...extra, owner: cliente ?? undefined, periodo }, clave)
          : emitirFacturaOrden(ordenId!, extra, clave),
    )
    setEmitiendo(false)

    if (!r.success) {
      toast({ title: "No se pudo emitir", description: r.message, variant: "destructive" })
      return
    }

    toast({
      title: `Factura ${r.nombre ?? "creada"}`,
      description:
        r.estadoDian === "Accepted"
          ? `Aceptada por la DIAN${r.cufe ? ` · CUFE ${r.cufe.slice(0, 12)}…` : ""}`
          : "Quedó en borrador dentro de Siigo.",
    })
    setAbierto(false)
    onEmitida?.()
  }

  // Ya facturada: se muestra, no se ofrece emitir.
  if (facturaExistente && String(facturaExistente).trim() !== "") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Facturada
      </span>
    )
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-6 gap-1 text-[10px]" onClick={abrir}>
        <FileText className="h-3 w-3" />
        Facturar
      </Button>

      {abierto && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => !emitiendo && setAbierto(false)}
            aria-hidden
          />
          <div
            className="fixed left-1/2 top-1/2 z-50 w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-background shadow-xl"
            style={{ maxHeight: "90vh" }}
          >
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold">Emitir factura en Siigo</h3>
              <p className="text-xs text-muted-foreground">{orden}</p>
            </div>

            <div className="space-y-4 p-5">
              {verificando ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : verificacion && !verificacion.puede ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
                    <AlertTriangle className="h-4 w-4" />
                    No se puede facturar
                  </p>
                  <p className="mt-1 text-[11px] text-amber-900">{verificacion.motivo}</p>
                </div>
              ) : (
                <>
                  {/* Qué se va a emitir, antes de cualquier botón. */}
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-muted-foreground">Valor a facturar</span>
                      <span className="text-xl font-bold">{money(valor)}</span>
                    </div>
                    {config?.impuestoId && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Se le aplicará el impuesto configurado.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label className="text-xs">A quién se le factura</Label>
                    {elegido ? (
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{elegido.nombre}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {elegido.identificacion}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setElegido(null)}
                        >
                          Cambiar
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {/* Si el puente lo resuelve no hace falta elegir; si no,
                              hay que hacerlo a mano. Facturarle a quien no era
                              es el error más caro. */}
                          Si no eliges a nadie, se usa la correspondencia configurada para «
                          {cliente ?? "sin cliente"}». Si no hay, la emisión se detiene.
                        </p>
                        <div className="mt-1.5 flex gap-1.5">
                          <Input
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && buscar()}
                            placeholder="Nombre o NIT"
                            className="h-9 text-sm"
                          />
                          <Button variant="outline" onClick={buscar} className="h-9 px-2.5">
                            <Search className="h-4 w-4" />
                          </Button>
                        </div>
                        {candidatos.length > 0 && (
                          <div className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-border">
                            {candidatos.map((c) => (
                              <button
                                key={c.identificacion}
                                type="button"
                                onClick={() => setElegido(c)}
                                className="flex w-full items-center justify-between gap-2 border-b border-border/50 px-2.5 py-1.5 text-left text-xs last:border-0 hover:bg-muted/50"
                              >
                                <span className="truncate">{c.nombre}</span>
                                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                  {c.identificacion}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* El aviso de qué va a pasar, según la configuración. */}
                  <div
                    className={`rounded-lg border p-3 ${
                      config?.enviarDian
                        ? "border-red-300 bg-red-50"
                        : "border-border bg-muted/30"
                    }`}
                  >
                    <p
                      className={`text-[11px] ${config?.enviarDian ? "text-red-900" : "text-muted-foreground"}`}
                    >
                      {config?.enviarDian ? (
                        <>
                          <strong>Saldrá firmada y oficial ante la DIAN.</strong> No se podrá
                          borrar: solo anular con una nota crédito.
                        </>
                      ) : (
                        <>
                          Quedará como <strong>borrador</strong> en Siigo. Alguien debe revisarla y
                          enviarla desde allá.
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="outline" onClick={() => setAbierto(false)} disabled={emitiendo}>
                Cancelar
              </Button>
              <Button
                onClick={emitir}
                disabled={emitiendo || verificando || verificacion?.puede !== true}
                className="gap-1.5"
              >
                {emitiendo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Emitir factura
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
