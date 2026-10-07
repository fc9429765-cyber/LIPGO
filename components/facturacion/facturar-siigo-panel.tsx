"use client"

// FACTURAR A SIIGO
//
// Un período, un modo (contado o crédito), los filtros de siempre, y desde
// aquí se emite. En CRÉDITO se agrupa como el Ciclo --por proyecto y owner--
// y cada agrupación sale en un solo documento; en CONTADO cada orden es su
// propia factura.
//
// La pantalla dice de cada orden si se puede facturar y, si no, POR QUÉ,
// antes de que nadie pulse nada: lo que no pasó por Solicitar Facturas, lo
// que ya tiene factura, lo que vale cero. Un documento fiscal no se "prueba".

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { DatePickerField } from "@/components/ui/date-picker-field"
import { useToast } from "@/hooks/use-toast"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, RefreshCw, Search } from "lucide-react"
import BotonFacturarSiigo from "@/components/facturacion/boton-facturar-siigo"
import { listarOrdenesParaFacturar } from "@/lib/facturar-siigo-actions"
import { CORTE_CICLO_SIIGO } from "@/lib/ciclo-facturacion-shared"
import type { OrdenFacturable } from "@/lib/facturar-siigo-tipos"

const money = (v: number) => `$${Math.round(v || 0).toLocaleString("es-CO")}`

function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}
function primerDiaDelMes(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}
function ultimoDiaDelMes(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${iso.slice(0, 7)}-${String(d).padStart(2, "0")}`
}
function mesAnterior(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}
const piso = (d: string) => (d && d > CORTE_CICLO_SIIGO ? d : CORTE_CICLO_SIIGO)

type Modo = "contado" | "credito"
const TODOS = "__todos__"

export default function FacturarSiigoPanel({ empresas }: { empresas: Array<{ id: number; nombre: string }> }) {
  const { toast } = useToast()
  const hoy = hoyISO()

  // El período es la decisión central: se elige y se APLICA; los filtros de
  // abajo recortan sobre lo ya traído sin volver al servidor.
  const [desde, setDesde] = useState(piso(primerDiaDelMes(hoy)))
  const [hasta, setHasta] = useState(hoy)
  const [modo, setModo] = useState<Modo>("credito")
  const [fEmpresa, setFEmpresa] = useState<number | null>(null)
  const [fOwner, setFOwner] = useState(TODOS)
  const [fTransporte, setFTransporte] = useState(TODOS)
  const [fOperacion, setFOperacion] = useState(TODOS)
  const [fEstado, setFEstado] = useState<"facturables" | "todas" | "no">("todas")
  const [fPlaca, setFPlaca] = useState("")
  const [buscar, setBuscar] = useState("")

  const [ordenes, setOrdenes] = useState<OrdenFacturable[]>([])
  const [loading, setLoading] = useState(false)
  const [cargado, setCargado] = useState(false)

  const cargar = async () => {
    setLoading(true)
    const r = await listarOrdenesParaFacturar({ desde: piso(desde), hasta, empresaId: fEmpresa })
    if (r.success) {
      setOrdenes(r.data)
      setCargado(true)
    } else {
      toast({ title: "No se pudieron cargar las órdenes", description: r.message, variant: "destructive" })
    }
    setLoading(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Opciones de filtro: salen de lo que hay en el período, no de catálogos.
  const opciones = useMemo(() => {
    const u = (xs: (string | null)[]) => Array.from(new Set(xs.map((x) => String(x ?? "").trim()).filter(Boolean))).sort()
    return {
      owners: u(ordenes.map((o) => o.owner)),
      transportes: u(ordenes.map((o) => o.transporte)),
      operaciones: u(ordenes.map((o) => o.tipooperacion)),
    }
  }, [ordenes])

  const filtradas = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const placa = fPlaca.trim().toUpperCase()
    return ordenes.filter((o) => {
      if (modo === "contado" ? o.medio !== "Contado" : o.medio !== "Crédito") return false
      if (fEmpresa && o.idempresa !== fEmpresa) return false
      if (fOwner !== TODOS && o.owner !== fOwner) return false
      if (fTransporte !== TODOS && (o.transporte ?? "") !== fTransporte) return false
      if (fOperacion !== TODOS && (o.tipooperacion ?? "") !== fOperacion) return false
      if (placa && !String(o.placa ?? "").toUpperCase().includes(placa)) return false
      if (fEstado === "facturables" && !o.facturable) return false
      if (fEstado === "no" && o.facturable) return false
      if (q && !`${o.ordendecargue} ${o.placa ?? ""} ${o.cliente ?? ""} ${o.owner}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [ordenes, modo, fEmpresa, fOwner, fTransporte, fOperacion, fPlaca, fEstado, buscar])

  const resumen = useMemo(() => {
    const enModo = ordenes.filter((o) => (modo === "contado" ? o.medio === "Contado" : o.medio === "Crédito"))
    const sinDefinir = ordenes.filter((o) => o.medio === "Sin definir").length
    const fact = filtradas.filter((o) => o.facturable)
    return {
      total: filtradas.length,
      facturables: fact.length,
      valorFacturable: fact.reduce((s, o) => s + o.valor, 0),
      enCero: filtradas.filter((o) => o.valor <= 0).length,
      sinDefinir,
      otroModo: ordenes.length - enModo.length - sinDefinir,
    }
  }, [ordenes, filtradas, modo])

  const periodoTexto = `${piso(desde)} a ${hasta}`

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Elige el <strong>período de facturación</strong>, el modo y los filtros. En <strong>crédito</strong> las órdenes se agrupan
        por proyecto y owner y cada agrupación sale en un solo documento; en <strong>contado</strong> cada orden es su propia factura.
        Solo se factura lo que ya se solicitó en Solicitar Facturas y tiene valor.
      </p>

      {/* ---------- Período + modo ---------- */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2.5">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Período desde</Label>
          <DatePickerField value={desde} onChange={(v) => setDesde(piso(v))} className="h-8 w-[150px] text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Período hasta</Label>
          <DatePickerField value={hasta} onChange={setHasta} className="h-8 w-[150px] text-xs" />
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setDesde(piso(primerDiaDelMes(hoy))); setHasta(hoy) }}>
          Mes actual
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { const d = mesAnterior(hoy); setDesde(piso(d)); setHasta(ultimoDiaDelMes(d)) }}>
          Mes anterior
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setDesde(piso(primerDiaDelMes(hoy))); setHasta(`${hoy.slice(0, 7)}-15`) }}>
          1.ª quincena
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setDesde(piso(`${hoy.slice(0, 7)}-16`)); setHasta(ultimoDiaDelMes(hoy)) }}>
          2.ª quincena
        </Button>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Proyecto</Label>
          <select
            className="h-8 w-[190px] rounded-md border border-input bg-background px-2 text-xs"
            value={fEmpresa ?? ""}
            onChange={(e) => setFEmpresa(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todos los proyectos</option>
            {empresas.map((em) => (
              <option key={em.id} value={em.id}>
                {em.nombre} (ID {em.id})
              </option>
            ))}
          </select>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={cargar} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Aplicar período
        </Button>
        <span className="ml-auto text-[10px] text-muted-foreground">
          El período no baja del {CORTE_CICLO_SIIGO}: lo anterior ya se facturó por fuera.
        </span>
      </div>

      {/* ---------- Modo + filtros ---------- */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2.5">
        <div className="flex overflow-hidden rounded-md border">
          {(["credito", "contado"] as Modo[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModo(m)}
              className={`h-8 px-3 text-xs font-medium transition-colors ${
                modo === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
              }`}
            >
              {m === "credito" ? "Facturación a crédito" : "Facturación de contado"}
            </button>
          ))}
        </div>
        <Filtro label="Owner" value={fOwner} onChange={setFOwner} opciones={opciones.owners} />
        <Filtro label="Transporte" value={fTransporte} onChange={setFTransporte} opciones={opciones.transportes} />
        <Filtro label="Operación" value={fOperacion} onChange={setFOperacion} opciones={opciones.operaciones} />
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Placa</Label>
          <Input value={fPlaca} onChange={(e) => setFPlaca(e.target.value)} className="h-8 w-[110px] text-xs" placeholder="Placa" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Estado</Label>
          <select
            className="h-8 w-[150px] rounded-md border border-input bg-background px-2 text-xs"
            value={fEstado}
            onChange={(e) => setFEstado(e.target.value as any)}
          >
            <option value="todas">Todas</option>
            <option value="facturables">Solo facturables</option>
            <option value="no">Solo con impedimento</option>
          </select>
        </div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} className="h-8 pl-8 text-xs" placeholder="Orden, placa, cliente u owner" />
        </div>
      </div>

      {/* ---------- Resumen ---------- */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span>
          <strong>{resumen.total}</strong> orden(es) en {modo === "credito" ? "crédito" : "contado"} · {periodoTexto}
        </span>
        <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-800">
          <CheckCircle2 className="h-3 w-3" /> {resumen.facturables} facturables · {money(resumen.valorFacturable)}
        </Badge>
        {resumen.enCero > 0 && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> {resumen.enCero} en $0
          </Badge>
        )}
        {resumen.sinDefinir > 0 && (
          <span className="text-muted-foreground" title="Sin medio de pago en la orden y sin regla del proyecto que lo decida">
            {resumen.sinDefinir} sin medio definido (no salen en ningún modo)
          </span>
        )}
        {resumen.otroModo > 0 && (
          <span className="text-muted-foreground">
            {resumen.otroModo} en {modo === "credito" ? "contado" : "crédito"}
          </span>
        )}
      </div>

      {loading && !cargado ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Cargando…</div>
      ) : filtradas.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          No hay órdenes de {modo === "credito" ? "crédito" : "contado"} en {periodoTexto} con esos filtros.
        </div>
      ) : modo === "credito" ? (
        <Agrupaciones ordenes={filtradas} periodo={periodoTexto} onEmitida={cargar} />
      ) : (
        <TablaContado ordenes={filtradas} onEmitida={cargar} />
      )}
    </div>
  )
}

function Filtro({
  label,
  value,
  onChange,
  opciones,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  opciones: string[]
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <select
        className="h-8 w-[170px] rounded-md border border-input bg-background px-2 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={TODOS}>Todos</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crédito: agrupaciones por proyecto y owner, como el Ciclo
// ---------------------------------------------------------------------------

function Agrupaciones({ ordenes, periodo, onEmitida }: { ordenes: OrdenFacturable[]; periodo: string; onEmitida: () => void }) {
  const grupos = useMemo(() => {
    const m = new Map<string, OrdenFacturable[]>()
    for (const o of ordenes) {
      const k = `${o.idempresa}|${o.owner}`
      m.set(k, [...(m.get(k) ?? []), o])
    }
    return Array.from(m.entries())
      .map(([k, os]) => {
        const fact = os.filter((o) => o.facturable)
        return {
          key: k,
          proyecto: os[0].proyecto,
          owner: os[0].owner,
          ordenes: os,
          facturables: fact,
          total: os.reduce((s, o) => s + o.valor, 0),
          totalFacturable: fact.reduce((s, o) => s + o.valor, 0),
          mezclados: os.filter((o) => o.ownerMezclado).length,
        }
      })
      .sort((a, b) => a.proyecto.localeCompare(b.proyecto) || a.owner.localeCompare(b.owner))
  }, [ordenes])

  return (
    <div className="space-y-2">
      {grupos.map((g) => (
        <Agrupacion key={g.key} g={g} periodo={periodo} onEmitida={onEmitida} />
      ))}
    </div>
  )
}

function Agrupacion({
  g,
  periodo,
  onEmitida,
}: {
  g: {
    proyecto: string
    owner: string
    ordenes: OrdenFacturable[]
    facturables: OrdenFacturable[]
    total: number
    totalFacturable: number
    mezclados: number
  }
  periodo: string
  onEmitida: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const impedidas = g.ordenes.length - g.facturables.length
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <button type="button" onClick={() => setAbierto(!abierto)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {abierto ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {g.owner} <span className="font-normal text-muted-foreground">· {g.proyecto}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {g.ordenes.length} orden(es) · {g.facturables.length} facturables
              {impedidas > 0 ? ` · ${impedidas} con impedimento` : ""}
              {g.mezclados > 0 ? ` · ${g.mezclados} con owner mezclado` : ""}
            </p>
          </div>
        </button>
        <div className="text-right">
          <p className="text-sm font-bold tabular-nums">{money(g.totalFacturable)}</p>
          {g.total !== g.totalFacturable && (
            <p className="text-[10px] text-muted-foreground tabular-nums">de {money(g.total)} en total</p>
          )}
        </div>
        {g.facturables.length > 0 ? (
          <BotonFacturarSiigo
            ordenIds={g.facturables.map((o) => o.id)}
            orden={`${g.owner} · ${g.proyecto} · ${g.facturables.length} órdenes · ${periodo}`}
            cliente={g.owner}
            valor={g.totalFacturable}
            periodo={periodo}
            onEmitida={onEmitida}
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">Nada facturable aún</span>
        )}
      </div>
      {abierto && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-left">Fecha</th>
                <th className="p-2 text-left">Orden</th>
                <th className="p-2 text-left">Placa</th>
                <th className="p-2 text-left">Transporte</th>
                <th className="p-2 text-left">Operación</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2 text-left">Estado</th>
              </tr>
            </thead>
            <tbody>
              {g.ordenes.map((o) => (
                <FilaOrden key={o.id} o={o} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Contado: una orden, una factura
// ---------------------------------------------------------------------------

function TablaContado({ ordenes, onEmitida }: { ordenes: OrdenFacturable[]; onEmitida: () => void }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="p-2 text-left">Fecha</th>
            <th className="p-2 text-left">Orden</th>
            <th className="p-2 text-left">Proyecto</th>
            <th className="p-2 text-left">Owner</th>
            <th className="p-2 text-left">Placa</th>
            <th className="p-2 text-left">Transporte</th>
            <th className="p-2 text-right">Valor</th>
            <th className="p-2 text-left">Estado</th>
            <th className="p-2 text-center">Siigo</th>
          </tr>
        </thead>
        <tbody>
          {ordenes.map((o) => (
            <tr key={o.id} className="border-t">
              <td className="p-2">{o.fechacargue ?? "—"}</td>
              <td className="p-2 font-mono">{o.ordendecargue}</td>
              <td className="p-2">{o.proyecto}</td>
              <td className="p-2">
                {o.owner}
                {o.ownerMezclado && <span className="ml-1 text-[10px] text-amber-700">(mezclado)</span>}
              </td>
              <td className="p-2">{o.placa ?? "—"}</td>
              <td className="p-2">{o.transporte ?? "—"}</td>
              <td className={`p-2 text-right tabular-nums ${o.valor <= 0 ? "font-semibold text-red-700" : ""}`}>
                {money(o.valor)}
                {o.valor <= 0 && <span className="ml-1 text-[10px]">sin valor</span>}
              </td>
              <td className="p-2">
                <Estado o={o} />
              </td>
              <td className="p-2 text-center">
                <BotonFacturarSiigo
                  ordenId={o.id}
                  orden={o.ordendecargue}
                  cliente={o.cliente ?? o.owner}
                  valor={o.valor}
                  facturaExistente={o.facturasiigo ?? o.emitidaSiigo}
                  onEmitida={onEmitida}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FilaOrden({ o }: { o: OrdenFacturable }) {
  return (
    <tr className="border-t">
      <td className="p-2">{o.fechacargue ?? "—"}</td>
      <td className="p-2 font-mono">{o.ordendecargue}</td>
      <td className="p-2">{o.placa ?? "—"}</td>
      <td className="p-2">{o.transporte ?? "—"}</td>
      <td className="p-2">{o.tipooperacion ?? "—"}</td>
      <td className={`p-2 text-right tabular-nums ${o.valor <= 0 ? "font-semibold text-red-700" : ""}`}>{money(o.valor)}</td>
      <td className="p-2">
        <Estado o={o} />
      </td>
    </tr>
  )
}

/** Facturable, o el motivo exacto de por qué no: antes de pulsar, no después. */
function Estado({ o }: { o: OrdenFacturable }) {
  if (o.facturable) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 className="h-3 w-3" /> Lista
        {o.medioEsperado && <span className="text-[10px] text-muted-foreground">(medio por regla)</span>}
      </span>
    )
  }
  return (
    <span className="inline-flex items-start gap-1 text-amber-800" title={o.motivo ?? undefined}>
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="line-clamp-2 text-[11px]">{o.motivo}</span>
    </span>
  )
}
