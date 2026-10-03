"use client"

// Panel "Indicadores" de una pantalla (se abre desde components/contexto-modulo.tsx).
// Gerencia 2026-10-03: "es importante poder ver los indicadores de esa área en la pantalla
// de indicadores, enfocados al objetivo de servicio de cada área". Muestra, con la MISMA
// fuente del portal del área (getIndicadoresValores, mes en curso, proyecto seleccionado):
//   1. lo que hoy requiere acción en el área (pendientes vivos, clicables),
//   2. los indicadores de esta pantalla y luego los demás del área: valor, meta, semáforo y
//      detalle; el nombre abre la ficha del BSC; "Abrir" lleva a la pantalla donde se actúa,
//   3. la campana por indicador con meta para recibir el aviso por correo (SQL 218).
// Nunca queda en blanco: si el área no tiene indicadores mapeados, lo dice.

import { useEffect, useMemo, useState } from "react"
import { Bell, BellOff, ExternalLink, Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Eyebrow, Punto, type Tono } from "@/components/ui/lipgo"
import { toast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { groups } from "@/lib/dashboard-data"
import { AREA_KPIS, KPI_DEFS, kpiSev, kpisParaModulo, pantallaDeIndicador, type KpiSev } from "@/lib/kpis-area"
import { etiquetaDeModulo } from "@/lib/navegacion"
import { getIndicadoresValores } from "@/lib/sig-actions"
import { getPendientesPorPantalla, type PendientePantalla } from "@/lib/pendientes-pantalla-actions"
import { UMBRALES, formatearValor, type UmbralAlerta } from "@/lib/alertas-bsc"
import { cancelarSuscripcion, enviarPruebaAlerta, getMisSuscripciones, guardarSuscripcion, type SuscripcionMia } from "@/lib/alertas-bsc-actions"
import { BscIndicadorModal } from "@/components/indicadores/bsc-indicador-modal"

type Valor = { valor: number; base?: string }

const TONO: Record<KpiSev, Tono> = { good: "ok", warn: "atencion", crit: "critico", none: "neutro" }
const COLOR: Record<KpiSev, string> = { good: "text-ok-fg", warn: "text-atencion-fg", crit: "text-critico-fg", none: "text-muted-foreground" }

function mesEnCurso() {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
  return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy }
}

function modulosDelArea(gk: string): Set<string> {
  const g: any = groups.find((x) => x.key === gk)
  const out = new Set<string>()
  for (const m of g?.modules ?? []) out.add(m.name)
  for (const sg of g?.subgroups ?? []) for (const m of sg.modules ?? []) out.add(m.name)
  return out
}

export function IndicadoresPantalla({ groupKey, moduleName, onNavegar }: { groupKey: string; moduleName: string; onNavegar?: (modulo: string) => void }) {
  const { selectedEmpresaId, selectedEmpresaNombre } = useAuth()
  const transversal = groupKey === "sst" || groupKey === "certificaciones_lip"
  const empresaId = transversal ? null : selectedEmpresaId
  const nombreAlcance = transversal ? "LIP" : selectedEmpresaNombre ?? "este proyecto"
  const propios = kpisParaModulo(groupKey, moduleName).filter((k) => KPI_DEFS[k])
  const delArea = (AREA_KPIS[groupKey] ?? []).filter((k) => KPI_DEFS[k] && !propios.includes(k))
  const todas = [...propios, ...delArea]
  const hayMetas = todas.some((k) => KPI_DEFS[k].meta != null)
  const modulosArea = useMemo(() => modulosDelArea(groupKey), [groupKey])

  const [valores, setValores] = useState<Record<string, Valor> | null>(null)
  const [pendientes, setPendientes] = useState<PendientePantalla[]>([])
  const [susc, setSusc] = useState<SuscripcionMia[]>([])
  const [errorAlertas, setErrorAlertas] = useState<string | null>(null)
  const [correo, setCorreo] = useState("")
  const [umbral, setUmbral] = useState<UmbralAlerta>("atencion")
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [ver, setVer] = useState<string | null>(null)

  // Valores del BSC: mes en curso, mismo alcance que el portal del área.
  useEffect(() => {
    if (todas.length === 0 || (!empresaId && !transversal)) {
      setValores({})
      return
    }
    let cancel = false
    setValores(null)
    const { desde, hasta } = mesEnCurso()
    getIndicadoresValores(empresaId, desde, hasta)
      .then((r: any) => {
        if (!cancel) setValores(r?.success && r.valores ? (r.valores as Record<string, Valor>) : {})
      })
      .catch(() => {
        if (!cancel) setValores({})
      })
    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, empresaId])

  // Pendientes vivos del área (misma fuente que el portal y las pestañas).
  useEffect(() => {
    let cancel = false
    getPendientesPorPantalla(selectedEmpresaId ?? null)
      .then((r) => {
        if (!cancel) setPendientes(r.success && r.data ? r.data.filter((p) => modulosArea.has(p.modulo)) : [])
      })
      .catch(() => {})
    return () => {
      cancel = true
    }
  }, [selectedEmpresaId, modulosArea])

  const cargarSusc = () =>
    getMisSuscripciones(empresaId).then((r) => {
      if (r.success) {
        setSusc(r.data.suscripciones)
        setErrorAlertas(null)
        setCorreo((c) => c || r.data.correoHabitual || r.data.correoSugerido || "")
      } else setErrorAlertas(r.message)
    })
  useEffect(() => {
    if (hayMetas) cargarSusc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId, hayMetas])

  const suscDe = (k: string) => susc.find((s) => s.indicador === k && (s.empresa_id ?? null) === (empresaId ?? null) && s.activo)

  const alternar = async (k: string) => {
    const s = suscDe(k)
    setOcupado(k)
    const r = s ? await cancelarSuscripcion(s.id) : await guardarSuscripcion({ indicador: k, empresaId, umbral, correo })
    setOcupado(null)
    if (!r.success) {
      toast({ title: "No se pudo", description: r.message, variant: "destructive" })
      return
    }
    toast({ title: s ? "Alerta cancelada" : "Alerta activada", description: s ? undefined : `Te avisaremos a ${correo} cuando "${KPI_DEFS[k].nombre}" salga de meta en ${nombreAlcance}.` })
    cargarSusc()
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

  if (todas.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
        Esta área todavía no tiene indicadores mapeados en el BSC. Los indicadores se definen en el Tablero BSC (SIG) y se enlazan a cada pantalla.
      </div>
    )
  }

  const fila = (k: string) => {
    const def = KPI_DEFS[k]
    const v = valores?.[k]
    const tiene = !!v && typeof v.valor === "number" && Number.isFinite(v.valor)
    const sinDatos = (k === "sat_cliente" || k === "sat_conductor") && v?.base === "0 encuestas"
    const sev: KpiSev = tiene && !sinDatos ? kpiSev(def, v!.valor) : "none"
    const s = suscDe(k)
    const destino = pantallaDeIndicador(k).modulo
    const texto = valores == null ? "…" : sinDatos ? "sin datos" : tiene ? formatearValor(def, v!.valor) : "—"
    return (
      <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
        <Punto tono={TONO[sev]} />
        <button type="button" onClick={() => setVer(k)} className="min-w-0 flex-1 text-left" title="Ver la ficha y la tendencia del indicador">
          <p className="text-sm font-medium leading-tight">{def.nombre}</p>
          <p className="lg-num text-[11.5px] text-muted-foreground">
            {def.meta != null ? `Meta ${formatearValor(def, def.meta)} · ${def.higherBetter === false ? "menor es mejor" : "mayor es mejor"}` : "Informativo"}
            {v?.base && !sinDatos ? ` · ${v.base}` : ""}
            {s ? ` · aviso a ${s.correo}` : ""}
          </p>
        </button>
        <span className={`lg-num text-lg font-bold tabular-nums ${COLOR[sev]}`}>{texto}</span>
        <div className="flex items-center gap-1">
          {destino && destino !== moduleName && onNavegar && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => onNavegar(destino)} title={`Abrir ${etiquetaDeModulo(destino)}`}>
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{etiquetaDeModulo(destino)}</span>
            </Button>
          )}
          {def.meta != null && s && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => probar(k)} disabled={ocupado != null} title="Enviarme ahora el estado actual por correo">
              {ocupado === `prueba:${k}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Prueba</span>
            </Button>
          )}
          {def.meta != null && (
            <Button
              variant={s ? "default" : "outline"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => alternar(k)}
              disabled={ocupado != null || (!s && !correo) || !!errorAlertas}
              aria-pressed={!!s}
              title={s ? "Alerta activa: toca para cancelarla" : correo ? `Avisarme a ${correo} cuando salga de meta` : "Escribe abajo el correo donde avisar"}
            >
              {ocupado === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              {s ? "Activa" : "Avisarme"}
            </Button>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="mt-4 space-y-5">
      <p className="text-[11.5px] text-muted-foreground">
        Mes en curso · {nombreAlcance}. El punto es el semáforo frente a la meta del BSC; el nombre abre la ficha del indicador.
      </p>

      {pendientes.length > 0 && (
        <section>
          <Eyebrow>Hoy requiere acción</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pendientes
              .sort((a, b) => (a.nivel === b.nivel ? b.cantidad - a.cantidad : a.nivel === "alto" ? -1 : 1))
              .map((p) => (
                <button
                  key={`${p.modulo}|${p.texto}`}
                  type="button"
                  onClick={() => onNavegar?.(p.modulo)}
                  title={`Abrir ${etiquetaDeModulo(p.modulo)}`}
                  className={`lg-num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    p.nivel === "alto" ? "border-critico-bd bg-critico-bg text-critico-fg hover:bg-red-100" : "border-atencion-bd bg-atencion-bg text-atencion-fg hover:bg-orange-100"
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  {p.texto}
                  <span className="opacity-70">· {etiquetaDeModulo(p.modulo)}</span>
                </button>
              ))}
          </div>
        </section>
      )}

      {propios.length > 0 && (
        <section>
          <Eyebrow>De esta pantalla</Eyebrow>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">{propios.map(fila)}</ul>
        </section>
      )}
      {delArea.length > 0 && (
        <section>
          <Eyebrow>Del área</Eyebrow>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">{delArea.map(fila)}</ul>
        </section>
      )}

      {hayMetas && (
        <section className="rounded-xl border border-border bg-muted/20 p-4">
          <Eyebrow>Avisos por correo</Eyebrow>
          {errorAlertas ? (
            <p className="mt-2 text-sm text-atencion-fg">{errorAlertas}</p>
          ) : (
            <>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Cada mañana se evalúa el mes en curso. Si un indicador con campana activa sale de meta, te llega un correo con el enlace a la pantalla donde se actúa. Las cuentas @lipgo.app no son buzones.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
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
              <p className="mt-1.5 text-[11px] text-muted-foreground">{UMBRALES.find((u) => u.valor === umbral)?.descripcion} Se guardan al activar cada campana.</p>
            </>
          )}
        </section>
      )}

      {ver && <BscIndicadorModal codigo={ver} def={KPI_DEFS[ver]} actual={valores?.[ver]?.valor ?? null} onClose={() => setVer(null)} />}
    </div>
  )
}
