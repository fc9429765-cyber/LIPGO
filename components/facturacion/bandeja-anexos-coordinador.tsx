"use client"

/**
 * BANDEJA DEL COORDINADOR LIP — lo que el ciclo de facturación le envió a su proyecto y
 * espera la firma del cliente.
 *
 * Vive DENTRO de Solicitar Facturas, que es donde el coordinador ya trabaja todos los días,
 * y solo aparece cuando hay algo esperándolo: para todos los demás no ocupa un píxel.
 *
 * Cada tarjeta dice qué llegó (anexo o factura), de qué cliente y período, por cuánto,
 * cuántos días lleva esperando, deja VER el documento tal como se envió, y permite subir
 * el firmado con el mismo uploader del ciclo (cámara o archivo). Al subirlo, el ciclo
 * avanza solo al paso siguiente —que es de Cartera LIP— y la tarjeta desaparece.
 */

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, ExternalLink, FileSignature, Inbox, Loader2, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { AdjuntosUploader } from "@/components/ciclo-facturacion/adjuntos-uploader"
import { listarBandejaCoordinador, type ItemBandejaCoordinador } from "@/lib/bandeja-facturacion-actions"

const money = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`

export function BandejaAnexosCoordinador({ usuario, empresaId }: { usuario: string; empresaId: number | null }) {
  const { toast } = useToast()
  const [items, setItems] = useState<ItemBandejaCoordinador[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const r = await listarBandejaCoordinador()
    if (r.success) setItems(r.data)
    else setError(r.message ?? "No se pudo leer la bandeja.")
    setCargando(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  // Primero lo del proyecto en el que está parado; el resto debajo. Nunca se oculta lo
  // de sus otros proyectos: una firma pendiente no deja de serlo por cambiar de pestaña.
  const ordenados = [...items].sort((a, b) => {
    const pa = empresaId != null && a.idempresa === empresaId ? 0 : 1
    const pb = empresaId != null && b.idempresa === empresaId ? 0 : 1
    if (pa !== pb) return pa - pb
    return (b.diasEsperando ?? 0) - (a.diasEsperando ?? 0)
  })

  // Sin nada pendiente, y sin error, no se muestra: la bandeja es para actuar, no para decorar.
  if (!cargando && !error && items.length === 0) return null

  return (
    <Card className="border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/10">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4 text-amber-700 dark:text-amber-400" />
              Firmas pendientes de tus clientes
              {items.length > 0 && <Badge className="bg-amber-600 text-white hover:bg-amber-600">{items.length}</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Lo que Cartera LIP envió a tus proyectos y espera la firma del cliente. Al subir el documento firmado, el ciclo
              sigue solo.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={cargar} disabled={cargando}>
            <RefreshCw className={"h-3.5 w-3.5 " + (cargando ? "animate-spin" : "")} /> Actualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}
        {cargando && items.length === 0 && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando lo que te enviaron…
          </div>
        )}
        {ordenados.map((it) => {
          const atrasado = (it.diasEsperando ?? 0) >= 7
          return (
            <div
              key={it.prefacturaId}
              className={
                "rounded-md border bg-background p-3 " +
                (atrasado ? "border-red-300 dark:border-red-800" : "border-border")
              }
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    <FileSignature className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                    {it.estado_ciclo === "pendiente_firma_anexo" ? "Anexo por firmar" : "Factura por firmar"}
                    <span className="font-normal text-muted-foreground">· {it.proyecto}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Cliente <span className="font-medium text-foreground">{it.owner}</span>
                    {it.periodo_desde && it.periodo_hasta && (
                      <>
                        {" "}· período {it.periodo_desde} a {it.periodo_hasta}
                      </>
                    )}
                    {" "}· <span className="font-medium text-foreground">{money(it.total)}</span>
                  </div>
                  <div className="mt-1 text-xs">{it.tarea}.</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {it.diasEsperando != null && (
                    <Badge variant={atrasado ? "destructive" : "secondary"} className="text-[10px]">
                      {it.diasEsperando === 0 ? "Llegó hoy" : `Lleva ${it.diasEsperando} día${it.diasEsperando === 1 ? "" : "s"}`}
                    </Badge>
                  )}
                  {it.documentoUrl ? (
                    <a
                      href={it.documentoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Ver {it.estado_ciclo === "pendiente_firma_anexo" ? "el anexo" : "la factura"}
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Sin documento adjunto</span>
                  )}
                </div>
              </div>

              {it.advertencias.length > 0 && (
                <div className="mt-2 rounded border border-amber-300 bg-amber-50/60 p-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                  <div className="mb-0.5 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="h-3 w-3" /> Este anexo se generó con advertencias
                  </div>
                  <ul className="space-y-0.5">
                    {it.advertencias.slice(0, 3).map((a, i) => (
                      <li key={i}>
                        <span className="font-medium">{a.tipo}:</span> {a.detalle}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-2 border-t pt-2">
                <AdjuntosUploader
                  prefacturaId={it.prefacturaId}
                  evento={it.evento}
                  usuario={usuario}
                  label={it.evento === "anexo_firmado" ? "Subir anexo firmado" : "Subir factura firmada"}
                  onDone={() => {
                    toast({
                      title: "Firmado y enviado a Cartera LIP",
                      description: `${it.owner} · ${it.proyecto}. El ciclo sigue con el paso de Cartera.`,
                    })
                    cargar()
                  }}
                />
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
