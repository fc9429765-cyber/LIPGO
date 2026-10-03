"use client"

// "Avisarme": suscripción a alertas del BSC desde el panel Indicadores de la pantalla
// (components/contexto-modulo.tsx). Cada indicador con meta tiene una campana; el aviso
// llega por correo cuando sale de meta (umbral elegido). Las cuentas @lipgo.app no son
// buzones, así que se pide un correo real (se sugiere el de recuperación de la clave).

import { useEffect, useState } from "react"
import { Bell, BellOff, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Chip, Eyebrow } from "@/components/ui/lipgo"
import { toast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { KPI_DEFS, kpisParaModulo } from "@/lib/kpis-area"
import { UMBRALES, formatearValor, type UmbralAlerta } from "@/lib/alertas-bsc"
import { cancelarSuscripcion, enviarPruebaAlerta, getMisSuscripciones, guardarSuscripcion, type SuscripcionMia } from "@/lib/alertas-bsc-actions"

type Datos = { suscripciones: SuscripcionMia[]; correoSugerido: string | null; correoHabitual: string | null }

export function AlertasIndicadores({ groupKey, moduleName }: { groupKey: string; moduleName: string }) {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const keys = kpisParaModulo(groupKey, moduleName).filter((k) => KPI_DEFS[k]?.meta != null)
  const transversal = groupKey === "sst" || groupKey === "certificaciones_lip"
  const empresaId = transversal ? null : selectedEmpresaId
  const [data, setData] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [correo, setCorreo] = useState("")
  const [umbral, setUmbral] = useState<UmbralAlerta>("atencion")
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = () =>
    getMisSuscripciones(empresaId).then((r) => {
      if (r.success) {
        setData(r.data)
        setError(null)
        setCorreo((c) => c || r.data.correoHabitual || r.data.correoSugerido || "")
      } else setError(r.message)
    })
  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId])

  if (keys.length === 0) return null

  const suscDe = (k: string) => data?.suscripciones.find((s) => s.indicador === k && (s.empresa_id ?? null) === (empresaId ?? null) && s.activo)

  const alternar = async (k: string) => {
    const s = suscDe(k)
    setOcupado(k)
    const r = s ? await cancelarSuscripcion(s.id) : await guardarSuscripcion({ indicador: k, empresaId, umbral, correo })
    setOcupado(null)
    if (!r.success) {
      toast({ title: "No se pudo", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: s ? "Alerta cancelada" : "Alerta activada", description: s ? undefined : `Te avisaremos a ${correo} cuando "${KPI_DEFS[k].nombre}" salga de meta en ${transversal ? "LIP" : selectedEmpresaNombre ?? "este proyecto"}.` })
    cargar()
  }

  const probar = async (k: string) => {
    const s = suscDe(k)
    if (!s) return
    setOcupado(`prueba:${k}`)
    const r = await enviarPruebaAlerta(s.id)
    setOcupado(null)
    if (r.success) toast({ title: "Prueba enviada", description: r.data.detalle })
    else toast({ title: "No se envió", description: r.message, variant: "destructive" })
  }

  return (
    <section className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Eyebrow>Avisarme por correo</Eyebrow>
          <p className="mt-1 text-sm">Cuando un indicador salga de meta en {transversal ? "LIP" : selectedEmpresaNombre ?? "este proyecto"}, te llega un correo con el enlace a la pantalla donde se actúa. Se evalúa cada mañana sobre el mes en curso.</p>
        </div>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-atencion-fg">{error}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
            <div className="space-y-1.5">
              <Label htmlFor="alerta-correo" className="text-xs">Correo donde avisar</Label>
              <Input id="alerta-correo" type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@empresa.com" className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Avisar cuando</Label>
              <Select value={umbral} onValueChange={(v) => setUmbral(v as UmbralAlerta)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{UMBRALES.map((u) => <SelectItem key={u.valor} value={u.valor}>{u.etiqueta}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{UMBRALES.find((u) => u.valor === umbral)?.descripcion} El correo y el umbral se guardan al activar cada campana.</p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-background">
            {keys.map((k) => {
              const def = KPI_DEFS[k]
              const s = suscDe(k)
              const trabajando = ocupado === k
              return (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{def.nombre}</p>
                    <p className="lg-num text-xs text-muted-foreground">
                      Meta {formatearValor(def, def.meta!)} · {def.higherBetter === false ? "menor es mejor" : "mayor es mejor"}
                      {s ? ` · aviso a ${s.correo} · ${s.umbral === "critico" ? "solo crítico" : "fuera de meta"}` : ""}
                      {s?.ultimoEnvio ? ` · último aviso ${new Date(s.ultimoEnvio).toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" })}${s.ultimoEstado === "error" ? " (falló)" : ""}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {s && (
                      <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => probar(k)} disabled={ocupado != null} title="Enviarme ahora el estado actual del indicador">
                        {ocupado === `prueba:${k}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Prueba
                      </Button>
                    )}
                    <Button variant={s ? "default" : "outline"} size="sm" className="h-8 gap-1.5 text-xs" onClick={() => alternar(k)} disabled={ocupado != null || (!s && !correo)} aria-pressed={!!s}>
                      {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                      {s ? "Activa" : "Avisarme"}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          {data && data.suscripciones.filter((s) => !keys.includes(s.indicador)).length > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              También tienes alertas en otras pantallas: {data.suscripciones.filter((s) => !keys.includes(s.indicador)).map((s) => s.nombre).join(", ")}.
              <Chip tono="neutro" className="ml-1">se gestionan desde su pantalla</Chip>
            </p>
          )}
        </>
      )}
    </section>
  )
}
